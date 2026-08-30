import logging
from pathlib import Path

import pycolmap

from .errors import PipelineError
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)

# CLAUDE.md's Pose estimation stage: "treat under 80% registered as a failed
# job".
MIN_REGISTERED_RATIO = 0.8
MATCHING_NUM_THREADS = 1


def verify_reconstruction(sparse_dir: Path, frames_dir: Path) -> None:
    sub_models = sorted(p.name for p in sparse_dir.iterdir() if p.is_dir())
    if sub_models != ["0"]:
        raise PipelineError(
            "sfm:verify",
            f"expected exactly one sub-model (sparse/0), found {sub_models or 'none'} "
            "— the reconstruction fragmented instead of producing one joint coordinate frame",
        )

    reconstruction = pycolmap.Reconstruction(str(sparse_dir / "0"))
    registered = len(reconstruction.images)
    total = len(list(frames_dir.glob("*.jpg")))
    ratio = registered / total if total else 0.0
    logger.info("sfm: %d/%d frames registered (%.1f%%)", registered, total, ratio * 100)

    # This message reaches the merchant as-is (worker.py forwards
    # PipelineError's text through JobStageRun.errorMessage / Job.errorMessage
    # — apps/web shows it verbatim), so it explains the likely cause in plain
    # language rather than just reporting a bare percentage — CLAUDE.md's own
    # non-negotiable example is exactly this message shape.
    if ratio < MIN_REGISTERED_RATIO:
        raise PipelineError(
            "sfm:verify",
            f"only {ratio:.0%} of frames registered — the product may have moved during capture, "
            "or its surface may be too low-texture, glossy, or reflective for reconstruction. Try "
            "reshooting on a matte, textured background, with even lighting and no glare, and hold "
            "the product still for the whole video.",
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
            # One video, one device, one lens for the whole capture.
            "--ImageReader.single_camera", "1",
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

    # An orbit capture repeatedly sees the same faces of the product from
    # non-adjacent points in time (orbit 2 passing the same side as orbit 1,
    # the top-down pass overlapping every orbit) — sequential matching alone
    # only links temporally-adjacent frames, so this loop-closure pass is
    # what actually ties the separate orbits into one joint reconstruction.
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
