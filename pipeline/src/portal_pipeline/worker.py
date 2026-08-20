import json
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import redis
import requests

from .capture_manifest import CaptureEntry, read_capture_manifest, write_capture_manifest
from .cli import REPO_ROOT
from .compress import run_compress
from .db import (
    VideoRecord,
    advance_job_stage,
    fetch_videos,
    mark_job_failed_directly,
    start_job,
    update_tour_status,
)
from .extract import run_extract
from .nav import run_nav
from .sfm import run_sfm
from .storage import download_video, make_s3_client, upload_tour_outputs, video_storage_key_to_local_name
from .train import run_train

logger = logging.getLogger(__name__)

# Must match apps/web/src/lib/queue.ts's PIPELINE_QUEUE_KEY — that's the
# only contract between the two sides of this queue, so it isn't read from
# config; it's a fixed, shared constant like any other API surface.
PIPELINE_QUEUE_KEY = "portal:pipeline:jobs"
BRPOP_TIMEOUT_S = 5

# Confirmed empirically (see task notes): colmap/glomap are NOT on this
# machine's persisted User or Machine PATH, only ever present transiently
# in whichever shell set them up. The gsplat training venv is separate from
# this package's own venv (gsplat's wheels are cp310-only). Defaults match
# this machine's actual install locations; override via env for another box.
DEFAULT_GSPLAT_PYTHON = r"C:\tools\gsplat_train\.venv\Scripts\python.exe"
# vocab_tree_flickr100K_words32K.bin is a legacy FLANN-format index — COLMAP
# switched to FAISS in May 2025, so any COLMAP build compiled after that
# (including the pinned one below) fails to read it ("Check failed:
# file_version == 1") rather than falling back gracefully. This is a FAISS
# index built locally from a real capture's own features (confirmed working
# end-to-end); it's a small (256-word) stopgap suited to unblocking jobs
# immediately, not a properly-sized general-purpose tree — worth replacing
# with a larger tree built from a broad, diverse image set once there's time,
# same as the original file was presumably meant to be.
DEFAULT_VOCAB_TREE = r"C:\tools\vocab_tree_local_faiss_fast.bin"
# colmap-extract (COLMAP 4.1.1) renamed CLI flags and changed its feature/
# matching database schema in a way GLOMAP 1.2.0 can't read ("SQL logic
# error"). colmap-3126-extract is COLMAP 3.12.6, the last version verified
# compatible with GLOMAP's database reader — see sfm.py's own pin comment.
# Confirmed the hard way: a real sfm run fails at the matching stage with
# colmap-extract on PATH ahead of this one.
DEFAULT_EXTRA_PATH_DIRS = r"C:\tools\colmap-3126-extract\bin;C:\tools\glomap-extract\bin"

# nav has no Tour status of its own — it's the fast, final manifest-assembly
# step, folded into COMPRESSING right up until the terminal PUBLISHED
# transition (which the /complete callback owns, not this table).
STAGE_TO_TOUR_STATUS = {
    "extract": "EXTRACTING",
    "sfm": "SFM",
    "train": "TRAINING",
    "compress": "COMPRESSING",
    "nav": "COMPRESSING",
}


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    redis_url: str
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str
    r2_public_base_url: str
    app_url: str
    callback_secret: str
    vocab_tree: str


def load_environment() -> None:
    from dotenv import load_dotenv

    # pipeline/.env (pipeline-specific: tool paths, overrides) is loaded
    # first so it wins; apps/web/.env then fills in the shared infra
    # credentials (DATABASE_URL, REDIS_URL, R2 keys, WORKER_CALLBACK_SECRET)
    # so they only need to be set in one place. load_dotenv never overrides
    # an already-set variable, so real OS environment always wins over both.
    load_dotenv(REPO_ROOT / "pipeline" / ".env")
    load_dotenv(REPO_ROOT / "apps" / "web" / ".env")


def configure_tool_paths() -> None:
    extra_dirs = os.environ.get("PORTAL_EXTRA_PATH_DIRS", DEFAULT_EXTRA_PATH_DIRS)
    os.environ["PATH"] = extra_dirs + os.pathsep + os.environ.get("PATH", "")
    os.environ.setdefault("PORTAL_GSPLAT_PYTHON", DEFAULT_GSPLAT_PYTHON)


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def load_config() -> WorkerConfig:
    return WorkerConfig(
        database_url=_required_env("DATABASE_URL"),
        redis_url=_required_env("REDIS_URL"),
        r2_account_id=_required_env("R2_ACCOUNT_ID"),
        r2_access_key_id=_required_env("R2_ACCESS_KEY_ID"),
        r2_secret_access_key=_required_env("R2_SECRET_ACCESS_KEY"),
        r2_bucket=_required_env("R2_BUCKET_NAME"),
        r2_public_base_url=_required_env("R2_PUBLIC_BASE_URL"),
        app_url=_required_env("NEXT_PUBLIC_APP_URL"),
        callback_secret=_required_env("WORKER_CALLBACK_SECRET"),
        vocab_tree=os.environ.get("PORTAL_VOCAB_TREE", DEFAULT_VOCAB_TREE),
    )


def make_workdir(job_id: str) -> Path:
    root = Path(os.environ.get("PORTAL_WORKDIR_ROOT", REPO_ROOT / "pipeline" / "work"))
    workdir = root / job_id
    workdir.mkdir(parents=True, exist_ok=True)
    return workdir


def download_all_videos(s3, bucket: str, videos: list[VideoRecord], raw_dir: Path) -> dict[str, VideoRecord]:
    filename_to_video: dict[str, VideoRecord] = {}
    for video in videos:
        filename = video_storage_key_to_local_name(video.role, video.area_name)
        download_video(s3, bucket, video.storage_key, raw_dir / filename)
        filename_to_video[filename] = video
    return filename_to_video


# extract.py has no way to know a video's real area_name/floor as the
# uploader entered them (apps/web's Video.areaName/floor) — it only ever
# sees the slugified <role>_<areaName>.mp4 filename this worker generated
# (video_storage_key_to_local_name), and area names with spaces/punctuation
# don't round-trip through that losslessly. It also assigns each folder a
# "{index:02d}_..." name from sorted(videos_dir.glob("*.mp4")) order, so the
# i-th folder (sorted alphabetically -- the zero-padded index makes that the
# same as numeric order) corresponds to the i-th filename (also sorted)
# this worker downloaded, both being deterministic functions of the same
# `videos` list. That correspondence is what lets the original, unmangled
# area_name/floor get patched back in after the fact instead of parsed back
# out of the filename.
def enrich_capture_manifest_with_video_records(frames_dir: Path, filename_to_video: dict[str, VideoRecord]) -> None:
    entries = read_capture_manifest(frames_dir)
    sorted_folder_names = sorted(entries.keys())
    sorted_filenames = sorted(filename_to_video.keys())
    if len(sorted_folder_names) != len(sorted_filenames):
        raise RuntimeError(
            f"capture_manifest has {len(sorted_folder_names)} folder(s) but {len(sorted_filenames)} "
            "video(s) were downloaded — extract.py must have dropped or split one"
        )

    updated: dict[str, CaptureEntry] = {}
    for folder_name, filename in zip(sorted_folder_names, sorted_filenames):
        entry = entries[folder_name]
        video = filename_to_video[filename]
        if video.role.lower() != entry.role.lower():
            raise RuntimeError(
                f"role mismatch reconciling capture_manifest: folder {folder_name!r} is "
                f"{entry.role!r}, matched video is {video.role!r} — sort-order correspondence broke"
            )
        updated[folder_name] = CaptureEntry(
            role=entry.role,
            area_name=video.area_name or entry.area_name,
            floor=video.floor,
        )
    write_capture_manifest(frames_dir, updated)


def call_completion_callback(
    config: WorkerConfig,
    job_id: str,
    *,
    status: str,
    manifest_url: str | None = None,
    error_message: str | None = None,
) -> None:
    payload: dict[str, str] = {"status": status}
    if manifest_url is not None:
        payload["manifestUrl"] = manifest_url
    if error_message is not None:
        payload["errorMessage"] = error_message[:2000]  # keep the DB column and email body sane

    response = requests.post(
        f"{config.app_url.rstrip('/')}/api/jobs/{job_id}/complete",
        json=payload,
        headers={"x-worker-secret": config.callback_secret},
        timeout=30,
    )
    response.raise_for_status()


def process_job(job_id: str, tour_id: str, config: WorkerConfig) -> None:
    workdir = make_workdir(job_id)
    logger.info("[job %s] starting, tour=%s workdir=%s", job_id, tour_id, workdir)

    try:
        videos = fetch_videos(config.database_url, tour_id)

        start_job(config.database_url, job_id, "download")
        s3 = make_s3_client(config.r2_account_id, config.r2_access_key_id, config.r2_secret_access_key)
        filename_to_video = download_all_videos(s3, config.r2_bucket, videos, workdir / "raw")

        def extract_and_reconcile() -> None:
            run_extract(workdir / "raw", workdir / "frames")
            enrich_capture_manifest_with_video_records(workdir / "frames", filename_to_video)

        for stage, run in (
            ("extract", extract_and_reconcile),
            ("sfm", lambda: run_sfm(workdir, Path(config.vocab_tree))),
            ("train", lambda: run_train(workdir)),
            ("compress", lambda: run_compress(workdir)),
            ("nav", lambda: run_nav(workdir, tour_id, REPO_ROOT)),
        ):
            advance_job_stage(config.database_url, job_id, stage)
            if stage in STAGE_TO_TOUR_STATUS:
                update_tour_status(config.database_url, tour_id, STAGE_TO_TOUR_STATUS[stage])
            run()

        advance_job_stage(config.database_url, job_id, "upload")
        manifest_url = upload_tour_outputs(
            s3, config.r2_bucket, config.r2_public_base_url, tour_id, workdir / "manifest.json"
        )

        call_completion_callback(config, job_id, status="success", manifest_url=manifest_url)
        logger.info("[job %s] complete: %s", job_id, manifest_url)
        shutil.rmtree(workdir, ignore_errors=True)

    except Exception as error:
        logger.exception("[job %s] failed", job_id)
        error_message = str(error)
        try:
            call_completion_callback(config, job_id, status="failure", error_message=error_message)
        except Exception:
            logger.exception("[job %s] callback unreachable, writing failure directly", job_id)
            mark_job_failed_directly(config.database_url, job_id, tour_id, error_message)
        logger.error("[job %s] workdir kept for debugging: %s", job_id, workdir)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    load_environment()
    configure_tool_paths()
    config = load_config()

    redis_client = redis.Redis.from_url(config.redis_url, decode_responses=True)
    logger.info("worker ready, watching %s", PIPELINE_QUEUE_KEY)

    while True:
        item = redis_client.brpop(PIPELINE_QUEUE_KEY, timeout=BRPOP_TIMEOUT_S)
        if item is None:
            continue

        _, raw_message = item
        try:
            message = json.loads(raw_message)
            job_id, tour_id = message["jobId"], message["tourId"]
        except (json.JSONDecodeError, KeyError) as error:
            logger.error("malformed queue message, dropping: %s (%s)", raw_message, error)
            continue

        process_job(job_id, tour_id, config)


if __name__ == "__main__":
    raise SystemExit(main())
