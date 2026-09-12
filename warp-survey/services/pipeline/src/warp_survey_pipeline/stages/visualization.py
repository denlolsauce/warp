"""Visualization branch stages: camera adaptation, terrain-safe cleanup, SOG.

Terrain-safe means exactly that: no segmentation, no support-surface removal,
no orientation heuristics, no size normalization. The only geometry change
allowed is a recorded translation to the local viewer origin and statistical
floater pruning that cannot move surviving gaussians.
"""

import json
import logging
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..backends.base import CameraRecord
from ..errors import PipelineError
from ..pointcloud import GridIndex

logger = logging.getLogger(__name__)

SPLAT_TRANSFORM_IMAGE = "warp-survey/splat-transform"
SPLAT_TRANSFORM_VERSION = "2.3.1"
SPLAT_TRANSFORM_DIGEST = "sha256:bb22d97d1f6b5e2a3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b"

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def _default_runner(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


# --- CAMERA_ADAPTATION --------------------------------------------------------

def adapt_cameras(
    cameras: list[CameraRecord],
    local_origin: tuple[float, float, float],
    output_path: Path,
) -> dict:
    """Translate reconstruction cameras into the LOCAL_VIEWER frame and write
    the canonical cameras JSON the splat trainer consumes.

    The transform is a pure translation by -localOrigin, recorded explicitly.
    Rotation/scale are untouched — the engineering frame's orientation and
    metric scale must survive into the visualization.
    """
    if not cameras:
        raise PipelineError("no reconstructed cameras available for splat training", transient=False)

    ox, oy, oz = local_origin
    adapted = []
    for cam in cameras:
        px, py, pz = cam.position_xyz
        adapted.append(
            {
                "imageName": cam.image_name,
                "fx": cam.fx,
                "fy": cam.fy,
                "cx": cam.cx,
                "cy": cam.cy,
                "width": cam.width,
                "height": cam.height,
                "position": [px - ox, py - oy, pz - oz],
                "rotation": cam.rotation_matrix_3x3,
            }
        )

    document = {
        "version": 1,
        "frame": "LOCAL_VIEWER",
        "localOrigin": [ox, oy, oz],
        "transform": {
            "from": "ENGINEERING",
            "to": "LOCAL_VIEWER",
            "translation": [-ox, -oy, -oz],
            "derivation": "translation by -localOrigin; rotation and scale preserved",
        },
        "cameras": adapted,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(document, indent=2))
    return {"cameraCount": len(adapted), "localOrigin": [ox, oy, oz]}


# --- TERRAIN_SAFE_CLEANUP -----------------------------------------------------

@dataclass
class CleanupResult:
    kept: np.ndarray  # boolean mask over input gaussians
    removed_low_opacity: int
    removed_oversized: int
    removed_isolated: int


def terrain_safe_cleanup(
    positions: np.ndarray,
    opacities: np.ndarray,
    scales: np.ndarray,
    min_opacity: float = 0.02,
    max_scale_m: float = 25.0,
    isolation_radius_m: float = 5.0,
    isolation_min_neighbors: int = 3,
) -> CleanupResult:
    """Prune obvious floaters without touching surviving geometry.

    Removals only — no recentring, no axis alignment, no rescaling. Those
    object-scan operations destroy georeferencing and are forbidden here.
    """
    n = len(positions)
    if n == 0:
        raise PipelineError("splat has no gaussians to clean", transient=False)

    keep = np.ones(n, dtype=bool)

    low_opacity = opacities < min_opacity
    keep &= ~low_opacity

    oversized = scales.max(axis=1) > max_scale_m
    keep &= ~oversized

    # Spatial isolation: gaussians with almost no neighbours are floaters.
    isolated = np.zeros(n, dtype=bool)
    surviving = np.flatnonzero(keep)
    if len(surviving) > isolation_min_neighbors:
        index = GridIndex.build(positions[surviving], cell=isolation_radius_m)
        for local_i, global_i in enumerate(surviving):
            p = positions[global_i]
            nb = index.query_radius_2d(float(p[0]), float(p[1]), isolation_radius_m)
            # query is 2D; check 3D distance for the vertical dimension too.
            if len(nb) > 0:
                pts = positions[surviving[nb]]
                d = np.sqrt(np.sum((pts - p) ** 2, axis=1))
                count = int((d <= isolation_radius_m).sum()) - 1  # exclude self
            else:
                count = 0
            if count < isolation_min_neighbors:
                isolated[global_i] = True
    keep &= ~isolated

    if keep.sum() == 0:
        raise PipelineError("cleanup removed every gaussian; thresholds are wrong for this scene", transient=False)

    return CleanupResult(
        kept=keep,
        removed_low_opacity=int(low_opacity.sum()),
        removed_oversized=int(oversized.sum()),
        removed_isolated=int(isolated.sum()),
    )


# --- SOG_COMPRESSION ----------------------------------------------------------

class SogCompressor:
    """@playcanvas/splat-transform in a pinned container: PLY → SOG."""

    def __init__(self, runner: Runner | None = None, image: str | None = None):
        self._runner = runner or _default_runner
        self._image = image or f"{SPLAT_TRANSFORM_IMAGE}@{SPLAT_TRANSFORM_DIGEST}"

    def version(self) -> str:
        return f"splat-transform-{SPLAT_TRANSFORM_VERSION}+{SPLAT_TRANSFORM_DIGEST[7:19]}"

    def compress(self, ply_path: Path, output_dir: Path) -> dict[str, Path]:
        """Produce full-quality and preview SOGs. The source PLY stays in
        cold storage for reprocessing."""
        if not ply_path.exists():
            raise PipelineError("trained splat PLY is missing", transient=False)
        output_dir.mkdir(parents=True, exist_ok=True)

        outputs = {
            "sog": output_dir / "splat.sog",
            "preview_sog": output_dir / "preview.sog",
        }
        jobs = [
            (outputs["sog"], []),
            (outputs["preview_sog"], ["--reduce", "0.15"]),
        ]
        for out_path, extra in jobs:
            cli = [
                "docker", "run", "--rm",
                "-v", f"{ply_path.parent}:/inputs",
                "-v", f"{output_dir}:/outputs",
                self._image,
                f"/inputs/{ply_path.name}",
                f"/outputs/{out_path.name}",
                *extra,
            ]
            logger.info("invoking splat-transform: %s", " ".join(cli))
            proc = self._runner(cli)
            if proc.returncode != 0:
                tail = (proc.stderr or proc.stdout or "")[-2000:]
                raise PipelineError(
                    f"SOG compression failed (exit {proc.returncode}). Last output: {tail}", transient=True
                )
            if not out_path.exists():
                raise PipelineError(f"splat-transform produced no {out_path.name}", transient=True)
        return outputs
