import json
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import redis
import requests

from .cleanup import Sam2SegmentationBackend, run_cleanup
from .cli import REPO_ROOT
from .compress import run_compress
from .db import (
    STAGE_ORDER,
    fetch_stage_runs,
    fetch_video,
    finish_stage_failure,
    finish_stage_success,
    mark_job_failed_directly,
    resume_stage,
    start_job,
    start_stage,
    update_product_status,
)
from .extract import run_extract
from .ingest import run_ingest
from .sfm import run_sfm
from .storage import UploadedAsset, download_video, make_s3_client, upload_product_outputs
from .train import run_train

logger = logging.getLogger(__name__)

# Must match apps/web/src/lib/queue.ts's PIPELINE_QUEUE_KEY — that's the
# only contract between the two sides of this queue, so it isn't read from
# config; it's a fixed, shared constant like any other API surface.
PIPELINE_QUEUE_KEY = "products:pipeline:jobs"
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
    sam2_checkpoint: str | None


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
    extra_dirs = os.environ.get("SPLAT_EXTRA_PATH_DIRS", DEFAULT_EXTRA_PATH_DIRS)
    os.environ["PATH"] = extra_dirs + os.pathsep + os.environ.get("PATH", "")
    os.environ.setdefault("SPLAT_GSPLAT_PYTHON", DEFAULT_GSPLAT_PYTHON)


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
        vocab_tree=os.environ.get("SPLAT_VOCAB_TREE", DEFAULT_VOCAB_TREE),
        # Optional, unlike the rest: cleanup.run_cleanup() runs without
        # background-segmentation pruning (logging a warning) rather than
        # failing the job when this isn't set — SAM 2 needs a real
        # checkpoint file provisioned on the GPU box, which is an
        # environment-setup step independent of getting the rest of the
        # pipeline running.
        sam2_checkpoint=os.environ.get("SAM2_CHECKPOINT"),
    )


def make_workdir(job_id: str) -> Path:
    root = Path(os.environ.get("SPLAT_WORKDIR_ROOT", REPO_ROOT / "pipeline" / "work"))
    workdir = root / job_id
    workdir.mkdir(parents=True, exist_ok=True)
    return workdir


def call_completion_callback(
    config: WorkerConfig,
    job_id: str,
    *,
    status: str,
    assets: dict[str, UploadedAsset] | None = None,
    error_message: str | None = None,
) -> None:
    payload: dict = {"status": status}
    if assets is not None:
        payload["assets"] = {
            name: {"key": asset.key, "url": asset.url, "sizeBytes": asset.size_bytes, "contentHash": asset.content_hash}
            for name, asset in assets.items()
        }
    if error_message is not None:
        payload["errorMessage"] = error_message[:2000]  # keep the DB column and email body sane

    response = requests.post(
        f"{config.app_url.rstrip('/')}/api/jobs/{job_id}/complete",
        json=payload,
        headers={"x-worker-secret": config.callback_secret},
        timeout=30,
    )
    response.raise_for_status()


def process_job(job_id: str, product_id: str, config: WorkerConfig) -> None:
    workdir = make_workdir(job_id)
    logger.info("[job %s] starting, product=%s workdir=%s", job_id, product_id, workdir)

    # Resuming a job that crashed mid-run (or was requeued after a worker
    # restart) picks up from the first stage that hasn't succeeded yet,
    # reusing this same deterministic workdir — earlier stages' outputs are
    # still on disk (the workdir is only ever deleted on full success), so
    # nothing already done gets recomputed. This is same-box resumability
    # only: a job resumed on a *different* worker box would need each
    # stage's artifact uploaded to R2 (JobStageRun.artifactKey) rather than
    # just left in a local workdir — that upload isn't wired up yet, so
    # artifactKey is currently always left null.
    stage_runs = fetch_stage_runs(config.database_url, job_id)
    resume_from = resume_stage(stage_runs)
    if resume_from is None:
        logger.info("[job %s] every stage already succeeded, nothing to do", job_id)
        return
    attempt_counts = {stage: sum(1 for run in stage_runs if run.stage == stage) for stage in STAGE_ORDER}

    try:
        video = fetch_video(config.database_url, product_id)
        start_job(config.database_url, job_id)
        update_product_status(config.database_url, product_id, "PROCESSING")

        s3 = make_s3_client(config.r2_account_id, config.r2_access_key_id, config.r2_secret_access_key)
        video_path = workdir / "raw" / "video.mp4"
        if not video_path.is_file():
            download_video(s3, config.r2_bucket, video.storage_key, video_path)

        segmentation_backend = (
            Sam2SegmentationBackend(checkpoint_path=Path(config.sam2_checkpoint))
            if config.sam2_checkpoint
            else None
        )

        stage_functions = {
            "INGEST": lambda: run_ingest(video_path),
            "FRAME_EXTRACTION": lambda: run_extract(video_path, workdir / "frames"),
            "POSE_ESTIMATION": lambda: run_sfm(workdir, Path(config.vocab_tree)),
            "TRAINING": lambda: run_train(workdir),
            "CLEANUP": lambda: run_cleanup(workdir, segmentation_backend),
            "COMPRESSION": lambda: run_compress(workdir),
        }

        assets: dict[str, UploadedAsset] | None = None
        start_index = STAGE_ORDER.index(resume_from)
        for stage in STAGE_ORDER[start_index:]:
            attempt_counts[stage] += 1
            attempt = attempt_counts[stage]
            start_stage(config.database_url, job_id, stage, attempt)
            try:
                if stage == "PUBLISH":
                    assets = upload_product_outputs(
                        s3, config.r2_bucket, config.r2_public_base_url, product_id,
                        workdir / "compressed" / "model.sog", workdir / "cleaned.ply",
                    )
                else:
                    stage_functions[stage]()
            except Exception as stage_error:
                finish_stage_failure(config.database_url, job_id, stage, attempt, str(stage_error))
                raise
            else:
                finish_stage_success(config.database_url, job_id, stage, attempt)

        call_completion_callback(config, job_id, status="success", assets=assets)
        logger.info("[job %s] complete", job_id)
        shutil.rmtree(workdir, ignore_errors=True)

    except Exception as error:
        logger.exception("[job %s] failed", job_id)
        error_message = str(error)
        try:
            call_completion_callback(config, job_id, status="failure", error_message=error_message)
        except Exception:
            logger.exception("[job %s] callback unreachable, writing failure directly", job_id)
            mark_job_failed_directly(config.database_url, job_id, product_id, error_message)
        logger.error("[job %s] workdir kept for debugging/resume: %s", job_id, workdir)


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
            job_id, product_id = message["jobId"], message["productId"]
        except (json.JSONDecodeError, KeyError) as error:
            logger.error("malformed queue message, dropping: %s (%s)", raw_message, error)
            continue

        process_job(job_id, product_id, config)


if __name__ == "__main__":
    raise SystemExit(main())
