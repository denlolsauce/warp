"""Pose estimation behind a swappable backend.

CLAUDE.md: "Pose-estimation and training live behind swappable interfaces
from day one". GLOMAP is the default and is unchanged — `GlomapPoseBackend`
is a thin wrapper over sfm.run_sfm, not a rewrite of it. `VggtPoseBackend`
is the feed-forward alternative CLAUDE.md's Pose estimation stage names as
the fallback for captures SfM can't register, and is opt-in until it has
been measured against GLOMAP on real product captures.

Both backends write the same artifact — a COLMAP sparse model at
<workdir>/sparse/0 — because that path is the contract every downstream
stage already reads (train.py's `--data-dir`, cleanup.py's
`pycolmap.Reconstruction`). Swapping the backend therefore changes nothing
downstream, which is the point.

The two backends fail differently, and that difference is the reason this
module exists rather than an `if` inside run_sfm:

  * SfM *tries* to register each frame and reports how many it managed, so
    a bad capture shows up as a low registration rate (sfm.py's
    MIN_REGISTERED_RATIO).
  * A feed-forward estimator emits a pose for every frame it is handed,
    always. Registration rate is structurally 100% and carries no
    information. VGGT's own per-pixel depth confidence is the only quality
    signal available, so that is what gets gated here — without it, the
    "fail loudly with a specific reason" non-negotiable would silently stop
    holding the moment this backend was enabled.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from .errors import PipelineError
from .sfm import run_sfm
from .subprocess_utils import run_command

logger = logging.getLogger(__name__)


class PoseBackend(Protocol):
    def estimate(self, workdir: Path) -> None:
        """Write a COLMAP sparse model to <workdir>/sparse/0 from <workdir>/frames."""
        ...


@dataclass(frozen=True)
class GlomapPoseBackend:
    """COLMAP feature extraction/matching + GLOMAP mapping — the default,
    and the only path with a proven end-to-end result on real captures.
    """

    vocab_tree: Path

    def estimate(self, workdir: Path) -> None:
        run_sfm(workdir, self.vocab_tree)


# VGGT's aggregator attends across all frames at once, so peak VRAM grows
# with frame count rather than staying flat like SfM's pairwise matching —
# 300+ frames does not fit on an A10G/L4. An orbit capture is highly
# redundant anyway (extract.py samples at 2fps), so an evenly-spaced subset
# spanning the whole capture keeps every viewpoint the reconstruction
# actually needs. Cleanup still projects against the frames it is given, so
# the frames not posed here are simply not used by later stages.
MAX_VGGT_FRAMES = 96

# demo_colmap.py's own default for its no-bundle-adjustment path. Depth
# confidence is a raw model score, not a probability — 5.0 is the value
# VGGT's authors filter at, and it is exposed on VggtConfig rather than
# hard-coded so it can be tuned per capture during the A/B against GLOMAP.
DEFAULT_CONF_THRESHOLD = 5.0
# Cap on points written into the sparse model. Purely a size limit on the
# artifact (the trainer only needs an initialisation cloud), so it is not
# part of the quality gate below.
DEFAULT_MAX_POINTS = 100_000

# Below this fraction of confidently-predicted depth samples, the geometry
# is not trustworthy enough to train on. VGGT will happily return a
# plausible-looking pose for a capture it has understood badly; this is the
# only place that can catch it, so it errs toward reporting rather than
# silently producing a bad splat. Provisional: it needs calibrating against
# real captures (both a known-good one and a known-bad one) before it can be
# trusted the way sfm.py's 80% registration threshold is.
MIN_CONFIDENT_POINT_FRACTION = 0.5


def vggt_runner_python() -> str:
    """The interpreter for the VGGT venv.

    Read lazily rather than as a module-level constant for the same reason
    train.py's gsplat_trainer_python() is — worker.py imports this module at
    its own module level, before configure_tool_paths() has run, so a
    constant computed here would freeze at "python" for the life of the
    process.
    """
    return os.environ.get("SPLAT_VGGT_PYTHON", "python")


@dataclass(frozen=True)
class VggtConfig:
    max_frames: int = MAX_VGGT_FRAMES
    conf_threshold: float = DEFAULT_CONF_THRESHOLD
    max_points: int = DEFAULT_MAX_POINTS
    min_confident_point_fraction: float = MIN_CONFIDENT_POINT_FRACTION


DEFAULT_VGGT_CONFIG = VggtConfig()


def select_frames(frame_paths: list[Path], max_frames: int) -> list[Path]:
    """An evenly-spaced subset of at most max_frames, in capture order.

    Spacing is over the whole capture rather than a leading slice: the
    orbits and the top-down pass are sequential in time, so taking the
    first N frames would pose one orbit and discard the viewpoints that
    give the reconstruction its top and bottom coverage.
    """
    if len(frame_paths) <= max_frames:
        return frame_paths
    indices = np.linspace(0, len(frame_paths) - 1, max_frames).round().astype(int)
    return [frame_paths[i] for i in indices]


def verify_vggt_metrics(metrics: dict, min_confident_point_fraction: float) -> None:
    """The feed-forward equivalent of sfm.verify_reconstruction's gate.

    This message reaches the merchant verbatim (worker.py forwards
    PipelineError text through JobStageRun.errorMessage), so it names the
    likely cause in plain language rather than reporting a raw score.
    """
    fraction = metrics.get("confident_point_fraction")
    if fraction is None:
        raise PipelineError(
            "pose:vggt:verify",
            "the pose estimator did not report a confidence score — its output cannot be trusted for training",
        )

    logger.info(
        "pose:vggt: %d frames posed, %d points, %.1f%% confident depth samples",
        metrics.get("frames", 0),
        metrics.get("points", 0),
        fraction * 100,
    )

    if fraction < min_confident_point_fraction:
        raise PipelineError(
            "pose:vggt:verify",
            f"only {fraction:.0%} of the estimated depth was confident — the product's shape could not be "
            "read reliably from this video. This usually means the surface is too glossy, reflective, or "
            "plain, the lighting changed during the capture, or the product moved. Try reshooting on a "
            "matte, textured background with even lighting and no glare, holding the product still.",
        )


@dataclass(frozen=True)
class VggtPoseBackend:
    """Feed-forward pose estimation — seconds of GPU time instead of the
    tens of CPU-minutes GLOMAP spends on feature matching, and it does not
    depend on a vocab tree or on SIFT finding texture to lock onto.

    Runs out-of-process against its own venv (SPLAT_VGGT_PYTHON), like
    train.py's gsplat trainer: VGGT pulls in torch+CUDA and a pinned
    dependency set that this package deliberately does not carry.

    NOT yet verified against a real capture in this environment — there is
    no GPU here to run it on. It is offered alongside GLOMAP, never instead
    of it, until it has been A/B'd on real product video; see
    pipeline/README.md.
    """

    config: VggtConfig = DEFAULT_VGGT_CONFIG

    def estimate(self, workdir: Path) -> None:
        frames_dir = workdir / "frames"
        if not frames_dir.is_dir():
            raise PipelineError("pose:vggt", f"frames directory not found: {frames_dir}")

        # sorted() puts these in ffmpeg's zero-padded numbering, i.e. capture
        # order — which is what makes select_frames' spacing temporal.
        frame_paths = sorted(frames_dir.glob("*.jpg"))
        if not frame_paths:
            raise PipelineError("pose:vggt", f"no frames found in {frames_dir}")
        selected = select_frames(frame_paths, self.config.max_frames)
        logger.info("pose:vggt: posing %d of %d frames", len(selected), len(frame_paths))

        sparse_dir = workdir / "sparse"
        sparse_dir.mkdir(parents=True, exist_ok=True)
        metrics_path = workdir / "pose_metrics.json"

        # The frame list goes through a file rather than argv: a full
        # capture's paths blow past the command-line length limit, and it
        # keeps the ordering explicit rather than relying on the subprocess
        # re-globbing in the same order.
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, dir=workdir, encoding="utf-8"
        ) as handle:
            json.dump([str(p) for p in selected], handle)
            frames_file = Path(handle.name)

        try:
            run_command(
                "pose:vggt",
                [
                    vggt_runner_python(), "-m", "splat_pipeline.vggt_runner",
                    "--frames-file", str(frames_file),
                    "--output-dir", str(sparse_dir),
                    "--metrics-path", str(metrics_path),
                    "--conf-threshold", str(self.config.conf_threshold),
                    "--max-points", str(self.config.max_points),
                ],
            )
        finally:
            frames_file.unlink(missing_ok=True)

        if not metrics_path.is_file():
            raise PipelineError(
                "pose:vggt",
                f"pose estimation reported success but wrote no metrics to {metrics_path}",
            )
        verify_vggt_metrics(
            json.loads(metrics_path.read_text()), self.config.min_confident_point_fraction
        )
