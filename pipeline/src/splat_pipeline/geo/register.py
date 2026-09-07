"""Fine alignment of a repeat capture onto its baseline.

Georeferencing puts both captures in metres in the same grid, but only to
within its GCP residuals — centimetres, on a good day. Centimetres is the
same order as the change worth reporting, so comparing two georeferenced
captures directly measures mostly registration slop.

The fix is the standard one in deformation monitoring: align on the parts of
the site that did not move, then measure everything against that. What
makes it work on a slope is *trimming* — plain ICP minimises over all
correspondences, so a genuinely changed region (a slip, a fresh cut) drags
the alignment toward itself and smears its own signal across the rest of the
site. Trimmed ICP (Chetverikov et al. 2002) fits each iteration to only the
best-matching TRIM_FRACTION of correspondences, which is exactly the stable
ground, and lets real change show up as the large residual it is.

The output's `rmse_m` is not a diagnostic. It is the registration error term
that change.py's level of detection is built from, so a poor alignment
widens the detection threshold instead of silently producing confident
nonsense.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from ..errors import PipelineError

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 60
# Fraction of correspondences kept per iteration. 0.7 assumes up to ~30% of
# the site may have genuinely changed between captures, which is generous
# for monitoring (a month of movement on a slope is usually a few percent)
# and still leaves ample support for a 6-DoF fit.
TRIM_FRACTION = 0.7
# Stop when the update stops mattering, expressed against the cloud's own
# resolution rather than an absolute distance: further iterations are just
# jitter inside a single point spacing.
CONVERGENCE_SHIFT_SPACING_FRACTION = 0.01
# Correspondences beyond this many point spacings are not the same piece of
# surface; keeping them would pull the fit toward whatever happens to be
# nearest in an area with no real counterpart (a region that fell away).
MAX_CORRESPONDENCE_SPACING_MULTIPLE = 10.0
# If trimmed ICP has to move the capture further than this, the two clouds
# were not in the same frame to begin with (mislabelled GCPs, a capture of
# a different part of the site) and a converged fit would be a false
# confirmation. Sized against the site, not absolute.
MAX_PLAUSIBLE_SHIFT_EXTENT_FRACTION = 0.25


@dataclass(frozen=True)
class CaptureAlignment:
    """Rigid transform putting a repeat capture onto its baseline.

    Rigid, not similarity: both captures are already in metres from their
    own GCP fits, so scale is a solved quantity. Re-estimating it here would
    let a real change in the site (a face retreating) be absorbed as a
    scale change and vanish from the measurement.
    """

    rotation: np.ndarray  # (3, 3)
    translation: np.ndarray  # (3,)
    rmse_m: float  # over inlier correspondences only
    inlier_count: int
    iterations: int
    converged: bool

    def apply(self, points: np.ndarray) -> np.ndarray:
        return np.atleast_2d(points) @ self.rotation.T + self.translation


def _fit_rigid(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Kabsch: the rotation+translation minimising |R@source + t - target|."""
    source_centroid, target_centroid = source.mean(axis=0), target.mean(axis=0)
    covariance = (target - target_centroid).T @ (source - source_centroid)
    u, _, vt = np.linalg.svd(covariance)
    correction = np.eye(3)
    if np.linalg.det(u @ vt) < 0:
        correction[2, 2] = -1.0
    rotation = u @ correction @ vt
    return rotation, target_centroid - rotation @ source_centroid


def align_captures(
    repeat_points: np.ndarray,
    baseline_points: np.ndarray,
    point_spacing_m: float,
    trim_fraction: float = TRIM_FRACTION,
    max_iterations: int = MAX_ITERATIONS,
) -> CaptureAlignment:
    """Trimmed rigid ICP of `repeat_points` onto `baseline_points`.

    Both must already be georeferenced to metres in the same grid; this only
    removes the residual misalignment their separate GCP fits left behind.
    """
    if len(repeat_points) < 3 or len(baseline_points) < 3:
        raise PipelineError(
            "geo:register",
            f"need at least 3 points in each capture to align, got {len(repeat_points)} repeat / "
            f"{len(baseline_points)} baseline",
        )
    if point_spacing_m <= 0:
        raise PipelineError("geo:register", f"point spacing must be positive, got {point_spacing_m}")

    tree = cKDTree(baseline_points)
    max_correspondence_m = point_spacing_m * MAX_CORRESPONDENCE_SPACING_MULTIPLE
    convergence_shift_m = point_spacing_m * CONVERGENCE_SHIFT_SPACING_FRACTION
    keep_count = max(3, int(len(repeat_points) * trim_fraction))

    rotation, translation = np.eye(3), np.zeros(3)
    moving = repeat_points.copy()
    rmse, inlier_count, converged, iterations = float("inf"), 0, False, 0

    for iterations in range(1, max_iterations + 1):
        distances, indices = tree.query(moving, k=1, workers=-1)

        # Trim in two steps, and in this order: drop correspondences that
        # can't be the same surface at all, then keep the best fraction of
        # what's left. Trimming first would let a region with no counterpart
        # fill the quota with matches that are merely "least bad".
        within_range = np.flatnonzero(distances <= max_correspondence_m)
        if len(within_range) < 3:
            raise PipelineError(
                "geo:register",
                "the two captures have almost no overlapping surface — fewer than 3 points found a "
                "counterpart within "
                f"{max_correspondence_m:.3f} m. Check the ground control points identify the same "
                "markers in both captures, and that both cover the same part of the site.",
            )
        ranked = within_range[np.argsort(distances[within_range], kind="stable")]
        inliers = ranked[: min(keep_count, len(ranked))]

        step_rotation, step_translation = _fit_rigid(moving[inliers], baseline_points[indices[inliers]])
        moving = moving @ step_rotation.T + step_translation
        rotation = step_rotation @ rotation
        translation = step_rotation @ translation + step_translation

        inlier_count = len(inliers)
        rmse = float(np.sqrt((distances[inliers] ** 2).mean()))
        if float(np.linalg.norm(step_translation)) < convergence_shift_m:
            converged = True
            break

    # Recompute against the final pose: the loop's rmse is measured from the
    # correspondences *before* the last update, so it lags by one iteration
    # and would understate a fit that was still moving when it stopped.
    final_distances, _ = tree.query(moving, k=1, workers=-1)
    final_inliers = np.sort(final_distances)[:inlier_count]
    rmse = float(np.sqrt((final_inliers ** 2).mean()))

    extent = float(np.linalg.norm(baseline_points.max(axis=0) - baseline_points.min(axis=0)))
    shift = float(np.linalg.norm(translation))
    if shift > extent * MAX_PLAUSIBLE_SHIFT_EXTENT_FRACTION:
        raise PipelineError(
            "geo:register",
            f"aligning the repeat capture required moving it {shift:.2f} m, which is more than a "
            f"quarter of the site's own {extent:.2f} m extent — these two captures are not of the "
            "same ground, or their control points are mislabelled. Refusing to report change "
            "measured against this alignment.",
        )

    logger.info(
        "geo:register: %s after %d iterations, %d inliers, RMSE=%.4f m, shift=%.4f m",
        "converged" if converged else "hit iteration limit", iterations, inlier_count, rmse, shift,
    )
    return CaptureAlignment(
        rotation=rotation,
        translation=translation,
        rmse_m=rmse,
        inlier_count=inlier_count,
        iterations=iterations,
        converged=converged,
    )
