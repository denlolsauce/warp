"""Reconstruction units -> metres, via ground control points.

SfM recovers a scene only up to an arbitrary similarity: 3 DoF rotation, 3
DoF translation, 1 DoF scale. Nothing in the product pipeline cares —
cleanup.compute_alignment_transform just normalises to a unit-ish box for
the viewer. Here it is the whole problem. "The batter has lost 40mm" is not
a statement a monocular reconstruction can make until an external length
has been tied into it.

The fit is Umeyama's closed-form similarity solution over the GCPs. It is
closed-form (not iterative), so with 3+ non-collinear points it either has
an answer or the points are degenerate — no convergence to babysit.

The residuals matter as much as the transform. A GCP RMSE of 40mm means
this survey cannot honestly report 40mm of movement, and change.py's level
of detection is what carries that fact downstream rather than leaving it in
a log line nobody reads.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from ..errors import PipelineError

logger = logging.getLogger(__name__)

MIN_CONTROL_POINTS = 3
# Non-collinearity check: the *second* singular value of the centred GCPs,
# relative to the first. Three points in a line leave the rotation about
# that line unconstrained, and Umeyama returns *an* answer for them rather
# than failing — the resulting scene can be rolled arbitrarily about the GCP
# axis with identical residuals, so this has to be rejected explicitly.
#
# Deliberately the second and not the third: the third would also reject
# *coplanar* control points, and markers surveyed on the ground surface of a
# slope are very nearly coplanar as a matter of normal practice. Three
# non-collinear points already determine a rotation fully, so coplanarity is
# not a degeneracy here.
MIN_CONTROL_POINT_CONDITION = 1e-3


@dataclass(frozen=True)
class GroundControlPoint:
    """One surveyed marker: where it sits in the reconstruction, and where
    it sits in the real world.

    `local` is in reconstruction units (picked in the viewer, or detected
    from a coded target). `world` is metres in the site's own grid — a
    projected CRS with a vertical datum, never lat/long degrees, since
    degrees are not a length and everything downstream subtracts these.
    """

    local: tuple[float, float, float]
    world: tuple[float, float, float]
    label: str = ""


@dataclass(frozen=True)
class SimilarityTransform:
    """world = scale * (rotation @ local) + translation."""

    scale: float
    rotation: np.ndarray  # (3, 3), proper (det = +1)
    translation: np.ndarray  # (3,)
    rmse_m: float
    per_point_residuals_m: np.ndarray

    def apply(self, points: np.ndarray) -> np.ndarray:
        return self.scale * (np.atleast_2d(points) @ self.rotation.T) + self.translation


def fit_similarity_transform(control_points: list[GroundControlPoint]) -> SimilarityTransform:
    """Umeyama (1991) least-squares similarity fit, local -> world metres."""
    if len(control_points) < MIN_CONTROL_POINTS:
        raise PipelineError(
            "geo:georeference",
            f"georeferencing needs at least {MIN_CONTROL_POINTS} ground control points, got "
            f"{len(control_points)} — without them the reconstruction has no real-world scale and "
            "no measurement can be reported in metres",
        )

    local = np.array([point.local for point in control_points], dtype=np.float64)
    world = np.array([point.world for point in control_points], dtype=np.float64)

    local_centroid, world_centroid = local.mean(axis=0), world.mean(axis=0)
    local_centred, world_centred = local - local_centroid, world - world_centroid

    spread = np.linalg.svd(local_centred, compute_uv=False)
    if spread[0] <= 0 or spread[1] / spread[0] < MIN_CONTROL_POINT_CONDITION:
        raise PipelineError(
            "geo:georeference",
            "the ground control points are collinear (or nearly so) — three points in a line "
            "leave the scene free to roll about that line, so the survey would be scaled correctly "
            "but rotated arbitrarily. Spread the control points across the site, off a single line.",
        )

    covariance = world_centred.T @ local_centred / len(control_points)
    u, singular_values, vt = np.linalg.svd(covariance)

    # Guard against a reflection: SVD's u @ vt can have det = -1, which
    # fits the points just as well while mirroring the site. A mirrored
    # slope has its normals inverted, so every M3C2 distance downstream
    # would come out with the wrong sign — loss read as gain.
    correction = np.eye(3)
    if np.linalg.det(u @ vt) < 0:
        correction[2, 2] = -1.0
    rotation = u @ correction @ vt

    local_variance = float((local_centred ** 2).sum() / len(control_points))
    if local_variance <= 0:
        raise PipelineError(
            "geo:georeference", "all ground control points share the same local position"
        )
    scale = float(np.trace(correction @ np.diag(singular_values)) / local_variance)
    translation = world_centroid - scale * (rotation @ local_centroid)

    residuals = np.linalg.norm(scale * (local @ rotation.T) + translation - world, axis=1)
    rmse = float(np.sqrt((residuals ** 2).mean()))

    logger.info(
        "geo:georeference: %d GCPs, scale=%.6g m/unit, RMSE=%.4f m (worst %.4f m)",
        len(control_points), scale, rmse, float(residuals.max()),
    )
    return SimilarityTransform(
        scale=scale,
        rotation=rotation,
        translation=translation,
        rmse_m=rmse,
        per_point_residuals_m=residuals,
    )
