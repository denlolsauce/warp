"""Gaussian-splat training backend interface + gsplat container implementation.

The visualization branch never feeds back into measurement: its outputs carry
an independent quality state and the viewer labels them "not for measurement".
Training runs in a pinned GPU container isolated from the photogrammetry
environment.
"""

import json
import logging
import subprocess
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from warp_survey_pipeline.errors import PipelineError

logger = logging.getLogger(__name__)

GSPLAT_IMAGE = "warp-survey/gsplat-trainer"
GSPLAT_VERSION = "1.4.0"
GSPLAT_CONTAINER_DIGEST = "sha256:aa11c86c0e5a4d0f9dbb26e13a5f8f8f4d3e2b1a0c9d8e7f6a5b4c3d2e1f0a9b"

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def _default_runner(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


@dataclass(frozen=True)
class SplatTrainingRequest:
    """Input to splat training: adapted cameras + images from reconstruction.

    cameras_json is the canonical camera set produced by CAMERA_ADAPTATION —
    already in the LOCAL_VIEWER frame (engineering minus localOrigin) so
    training never sees float32-hostile projected coordinates.
    """

    cameras_json: Path
    images_dir: Path
    output_dir: Path
    max_gaussians: int = 3_000_000
    iterations: int = 30_000


@dataclass(frozen=True)
class SplatTrainingResult:
    ply_path: Path
    gaussian_count: int
    provenance: dict[str, str]


class SplatBackend(ABC):
    """Swappable training backend (gsplat today)."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def version(self) -> str: ...

    @abstractmethod
    def train(self, request: SplatTrainingRequest) -> SplatTrainingResult: ...


class GsplatBackend(SplatBackend):
    """gsplat MCMC training in a pinned CUDA container."""

    def __init__(self, runner: Runner | None = None, image: str | None = None):
        self._runner = runner or _default_runner
        self._image = image or f"{GSPLAT_IMAGE}@{GSPLAT_CONTAINER_DIGEST}"

    @property
    def name(self) -> str:
        return "gsplat"

    def version(self) -> str:
        return f"gsplat-{GSPLAT_VERSION}+{GSPLAT_CONTAINER_DIGEST[7:19]}"

    def _build_cli_args(self, request: SplatTrainingRequest) -> list[str]:
        return [
            "docker", "run", "--rm", "--gpus", "all",
            "-v", f"{request.cameras_json.parent}:/inputs/cameras",
            "-v", f"{request.images_dir}:/inputs/images",
            "-v", f"{request.output_dir}:/outputs",
            self._image,
            "--cameras", f"/inputs/cameras/{request.cameras_json.name}",
            "--images", "/inputs/images",
            "--output", "/outputs/splat.ply",
            "--strategy", "mcmc",
            "--max-gaussians", str(request.max_gaussians),
            "--iterations", str(request.iterations),
        ]

    def train(self, request: SplatTrainingRequest) -> SplatTrainingResult:
        if not request.cameras_json.exists():
            raise PipelineError("adapted cameras file is missing; run CAMERA_ADAPTATION first", transient=False)
        if not request.images_dir.exists():
            raise PipelineError("training images directory is missing", transient=False)
        request.output_dir.mkdir(parents=True, exist_ok=True)

        cli = self._build_cli_args(request)
        logger.info("invoking gsplat trainer: %s", " ".join(cli))
        proc = self._runner(cli)
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout or "")[-2000:]
            raise PipelineError(f"splat training failed (exit {proc.returncode}). Last output: {tail}", transient=True)

        ply = request.output_dir / "splat.ply"
        stats_path = request.output_dir / "training_stats.json"
        if not ply.exists():
            raise PipelineError("splat training reported success but produced no splat.ply", transient=True)

        gaussian_count = 0
        if stats_path.exists():
            try:
                gaussian_count = int(json.loads(stats_path.read_text()).get("gaussianCount", 0))
            except (json.JSONDecodeError, TypeError, ValueError):
                logger.warning("unreadable training_stats.json; gaussian count unknown")

        return SplatTrainingResult(
            ply_path=ply,
            gaussian_count=gaussian_count,
            provenance={
                "backend": self.name,
                "gsplat_version": GSPLAT_VERSION,
                "container_digest": GSPLAT_CONTAINER_DIGEST,
                "container_image": self._image,
            },
        )
