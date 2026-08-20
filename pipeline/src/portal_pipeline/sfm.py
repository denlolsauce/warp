import logging
from pathlib import Path

import pycolmap

from .capture_manifest import read_capture_manifest
from .errors import PipelineError
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)

MIN_REGISTERED_RATIO = 0.6
MATCHING_NUM_THREADS = 1


def compute_registration_stats(
    registered_image_names: list[str], total_by_folder: dict[str, int]
) -> dict[str, tuple[int, int, float]]:
    registered_by_folder = {name: 0 for name in total_by_folder}
    for image_name in registered_image_names:
        folder_name = Path(image_name).parts[0]
        if folder_name in registered_by_folder:
            registered_by_folder[folder_name] += 1

    stats = {}
    for folder_name, total in total_by_folder.items():
        registered = registered_by_folder[folder_name]
        ratio = registered / total if total else 0.0
        stats[folder_name] = (registered, total, ratio)
    return stats


def verify_reconstruction(sparse_dir: Path, frames_dir: Path) -> None:
    sub_models = sorted(p.name for p in sparse_dir.iterdir() if p.is_dir())
    if sub_models != ["0"]:
        raise PipelineError(
            "sfm:verify",
            f"expected exactly one sub-model (sparse/0), found {sub_models or 'none'} "
            "— the reconstruction fragmented instead of producing one joint coordinate frame",
        )

    reconstruction = pycolmap.Reconstruction(str(sparse_dir / "0"))
    registered_image_names = [image.name for image in reconstruction.images.values()]

    total_by_folder = {
        folder.name: len(list(folder.glob("*.jpg")))
        for folder in sorted(frames_dir.iterdir())
        if folder.is_dir()
    }

    stats = compute_registration_stats(registered_image_names, total_by_folder)

    # This message reaches the customer as-is (worker.py forwards PipelineError's
    # text through the completion callback to Tour.errorMessage, shown verbatim
    # by TourStatus.tsx) — so it names the video by the customer's own area name,
    # not the internal "00_hallway"-style folder id, and explains the likely
    # cause in plain language rather than just reporting a bare percentage.
    capture_manifest = read_capture_manifest(frames_dir)
    failures = []
    for folder_name, (registered, total, ratio) in stats.items():
        logger.info("%s: %d/%d frames registered (%.1f%%)", folder_name, registered, total, ratio * 100)
        if ratio < MIN_REGISTERED_RATIO:
            entry = capture_manifest.get(folder_name)
            label = entry.area_name if entry else folder_name
            failures.append(f"{label} ({ratio:.0%} usable)")

    if failures:
        raise PipelineError(
            "sfm:verify",
            f"Reconstruction quality was too low for: {', '.join(failures)}. This usually means "
            "long stretches of plain, low-texture surfaces (bare walls, uniform flooring) that the "
            "3D reconstruction can't lock onto. Try reshooting that video more slowly for more "
            "overlap between frames, or briefly add texture to bare walls (a poster, patterned "
            "cloth) during filming.",
        )


# COLMAP >=4.0 renamed these flags (FeatureExtraction./FeatureMatching.) and
# changed its database schema (rig/frame tables) in a way GLOMAP 1.2.0 — the
# latest GLOMAP release — can't read ("SQLite error: SQL logic error" from
# glomap mapper). GLOMAP has no newer release, so pin COLMAP to <=3.12.x
# (verified against 3.12.6) until GLOMAP catches up.
def run_sfm(workdir: Path, vocab_tree: Path) -> None:
    frames_dir = workdir / "frames"
    if not frames_dir.is_dir():
        raise PipelineError("sfm", f"frames directory not found: {frames_dir}")
    if not vocab_tree.is_file():
        raise PipelineError("sfm", f"vocab tree file not found: {vocab_tree}")

    db_path = workdir / "db.db"
    sparse_dir = workdir / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    run_command(
        "sfm:feature_extractor",
        [
            "colmap", "feature_extractor",
            "--database_path", str(db_path),
            "--image_path", str(frames_dir),
            "--ImageReader.camera_model", "OPENCV",
            "--ImageReader.single_camera_per_folder", "1",
            "--SiftExtraction.use_gpu", "1",
            "--SiftExtraction.max_num_features", "8192",
        ],
    )

    run_command(
        "sfm:sequential_matcher",
        [
            "colmap", "sequential_matcher",
            "--database_path", str(db_path),
            "--SequentialMatching.overlap", "10",
            "--SequentialMatching.loop_detection", "1",
            "--SequentialMatching.vocab_tree_path", str(vocab_tree),
            # auto-detected thread count (-1, the default) deadlocks matching on
            # at least one real Windows/CUDA combo we've hit; pin it instead.
            "--SiftMatching.num_threads", str(MATCHING_NUM_THREADS),
        ],
    )

    # Fuses the per-video sequences into one coordinate frame. Sequential matching
    # alone only links temporally-adjacent frames, which almost never crosses a
    # video boundary — never skip this pass, even for a single-video Phase 1 run.
    run_command(
        "sfm:vocab_tree_matcher",
        [
            "colmap", "vocab_tree_matcher",
            "--database_path", str(db_path),
            "--VocabTreeMatching.vocab_tree_path", str(vocab_tree),
            "--SiftMatching.num_threads", str(MATCHING_NUM_THREADS),
        ],
    )

    run_command(
        "sfm:glomap_mapper",
        [
            "glomap", "mapper",
            "--database_path", str(db_path),
            "--image_path", str(frames_dir),
            "--output_path", str(sparse_dir),
        ],
    )

    verify_reconstruction(sparse_dir, frames_dir)
