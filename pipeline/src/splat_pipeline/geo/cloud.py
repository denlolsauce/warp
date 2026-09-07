"""Which gaussians count as ground surface.

A trained splat is not a survey point cloud. Alongside the surface it
contains low-opacity interior fill (see cleanup.DILATION_RADIUS_NN_MULTIPLE
for why that fill is deliberately kept for *rendering*) and a small number
of enormous, near-transparent gaussians that stand in for sky, haze and
distant background. Both are correct for a renderer and both are poison for
a measurement: they sit off the real surface and would be averaged into
every change distance computed here.

So measurement gets its own view of the same PLY — high-opacity, non-huge
gaussian centres only. This never rewrites the PLY; cleanup's output stays
exactly what the viewer loads.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from ..errors import PipelineError
from ..plysplit import load_ply_opacity, load_ply_positions, load_ply_scale

logger = logging.getLogger(__name__)

# A gaussian this transparent contributes almost nothing to the rendered
# surface but sits wherever MCMC last moved it, which for interior fill is
# well off the surface. 0.3 keeps the ones that actually form the visible
# skin: on the real captures in this repo it retains the solid shell while
# dropping the interior cloud that cleanup's dilation pass puts back.
MIN_SURFACE_OPACITY = 0.3
# Gaussians whose largest axis is in the top 1% by scale are the ones
# standing in for sky/haze/background — a handful of them, each spanning a
# large fraction of the scene. Their centres are meaningless as surface
# samples. A percentile rather than an absolute size because the threshold
# has to hold across a 3 m trial pit and a 200 m quarry face.
MAX_SCALE_PERCENTILE = 99.0
# Below this there isn't a surface to measure, and every downstream radius
# is derived from point spacing that would be nonsense at this size.
MIN_SURFACE_POINTS = 500


def median_point_spacing(points: np.ndarray) -> float:
    """Median nearest-neighbour distance — the cloud's own resolution.

    Every radius in this subsystem is expressed as a multiple of this rather
    than as an absolute distance, so the same defaults work on a trial pit
    and a quarry face (same reasoning as cleanup's RANSAC_DISTANCE_RATIO).
    """
    from scipy.spatial import cKDTree

    if len(points) < 2:
        raise PipelineError(
            "geo:cloud", f"need at least 2 points to measure point spacing, got {len(points)}"
        )
    distances, _ = cKDTree(points).query(points, k=2, workers=-1)
    return float(np.median(distances[:, 1]))


def load_surface_points(
    ply_path: Path,
    min_opacity: float = MIN_SURFACE_OPACITY,
    max_scale_percentile: float = MAX_SCALE_PERCENTILE,
) -> np.ndarray:
    """Gaussian centres from a splat PLY, filtered down to surface samples."""
    if not ply_path.is_file():
        raise PipelineError("geo:cloud", f"splat PLY not found: {ply_path}")

    ply, positions = load_ply_positions(ply_path)
    opacities = load_ply_opacity(ply)
    scales = load_ply_scale(ply).max(axis=1)

    keep = opacities >= min_opacity
    if keep.sum() < MIN_SURFACE_POINTS:
        raise PipelineError(
            "geo:cloud",
            f"only {int(keep.sum())} of {len(positions)} gaussians in {ply_path.name} are opaque "
            f"enough (>= {min_opacity:.2f}) to measure — the capture is too sparse or too "
            "under-trained to survey against",
        )

    scale_limit = float(np.percentile(scales[keep], max_scale_percentile))
    keep &= scales <= scale_limit

    logger.info(
        "geo:cloud: %d/%d gaussians retained as surface samples from %s",
        int(keep.sum()), len(positions), ply_path.name,
    )
    return positions[keep]
