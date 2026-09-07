"""M3C2 change detection between two aligned captures.

Implements Lague, Brodu & Leroux (2013), "Accurate 3D comparison of complex
topography with terrestrial laser scanner", which is the method geotechnical
practice already accepts for point-cloud change detection. Two properties
are why it, and not the obvious alternatives:

* **Signed distance along the local surface normal**, not nearest-neighbour
  distance. Nearest-neighbour distance is unsigned (it cannot tell erosion
  from deposition) and is biased by surface roughness — on a rough rock face
  the closest point is systematically nearer than the surface actually is.
  A slope also has genuinely vertical faces, so DEM-of-difference (subtract
  two raster surfaces) has no answer there at all; M3C2 works in full 3D.
* **A per-point level of detection.** Change is reported as significant only
  where it exceeds the local confidence interval built from each cloud's own
  roughness plus the registration error. Everywhere else the honest answer
  is "no change resolvable at this precision", not a small number that looks
  like a measurement.

The distances here are only as good as `registration_error_m`. That number
comes from register.align_captures' inlier RMSE, and it is deliberately not
optional or defaulted to zero: a zero registration error produces a
narrower level of detection, so forgetting it would manufacture confident
findings out of alignment noise.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from ..errors import PipelineError

logger = logging.getLogger(__name__)

# Lague et al.'s normal scale D: large enough that the fitted normal
# describes the surface rather than its roughness. 20 point spacings is a
# few decimetres on a drone capture of a slope — coarse enough to ignore
# individual cobbles, fine enough to follow a bench edge.
NORMAL_RADIUS_SPACING_MULTIPLE = 20.0
# The projection cylinder's radius (d/2). Smaller than the normal scale:
# the normal wants context, the distance wants locality.
CYLINDER_RADIUS_SPACING_MULTIPLE = 6.0
# Cylinder half-length: the largest displacement this survey can see at all.
# Movement beyond it leaves the cylinder and reads as "no counterpart" —
# reported as unmeasured rather than clipped to the maximum, since a clipped
# distance would understate exactly the biggest movements.
CYLINDER_HALF_LENGTH_SPACING_MULTIPLE = 40.0
# Fewer than this many points in a cylinder makes its standard deviation
# meaningless, and the level of detection is built from that deviation.
MIN_CYLINDER_POINTS = 4
# 1.96σ ~ 95% two-sided, matching the paper's LoD95%. Reported alongside the
# distances so a downstream consumer never has to guess the confidence level
# a "significant" flag was computed at.
CONFIDENCE_Z = 1.96
CONFIDENCE_LEVEL = 0.95


@dataclass(frozen=True)
class ChangeConfig:
    normal_radius_m: float
    cylinder_radius_m: float
    cylinder_half_length_m: float
    registration_error_m: float
    min_cylinder_points: int = MIN_CYLINDER_POINTS
    confidence_z: float = CONFIDENCE_Z

    @classmethod
    def from_point_spacing(
        cls, point_spacing_m: float, registration_error_m: float
    ) -> "ChangeConfig":
        """Radii derived from the cloud's own resolution, so one set of
        defaults holds from a trial pit to a quarry face."""
        if point_spacing_m <= 0:
            raise PipelineError("geo:change", f"point spacing must be positive, got {point_spacing_m}")
        if registration_error_m < 0:
            raise PipelineError(
                "geo:change", f"registration error cannot be negative, got {registration_error_m}"
            )
        return cls(
            normal_radius_m=point_spacing_m * NORMAL_RADIUS_SPACING_MULTIPLE,
            cylinder_radius_m=point_spacing_m * CYLINDER_RADIUS_SPACING_MULTIPLE,
            cylinder_half_length_m=point_spacing_m * CYLINDER_HALF_LENGTH_SPACING_MULTIPLE,
            registration_error_m=registration_error_m,
        )


@dataclass(frozen=True)
class ChangeField:
    """Per-core-point M3C2 result. Every array is parallel to `core_points`.

    `distance_m` is signed along `normal`: positive means the surface moved
    *along* the normal (outward, given normals oriented away from the
    ground — deposition, heave, a bulging face), negative means it moved
    back (erosion, a scaling rock face, settlement).

    `measured` is False where a core point had no usable counterpart in one
    of the clouds; `distance_m` is NaN there. That is a different statement
    from "no significant change" and is kept separate on purpose — an
    unmeasured hole in the survey is a reason to re-fly, whereas an
    insignificant reading is a positive finding of stability.
    """

    core_points: np.ndarray  # (N, 3) metres, from the baseline
    normal: np.ndarray  # (N, 3) unit
    distance_m: np.ndarray  # (N,) signed, NaN where not measured
    level_of_detection_m: np.ndarray  # (N,) 95% LoD, NaN where not measured
    roughness_baseline_m: np.ndarray  # (N,) local std along the normal
    roughness_repeat_m: np.ndarray
    count_baseline: np.ndarray  # (N,) points in cylinder
    count_repeat: np.ndarray
    measured: np.ndarray  # (N,) bool
    significant: np.ndarray  # (N,) bool: measured and |distance| > LoD
    config: ChangeConfig
    confidence_level: float = CONFIDENCE_LEVEL

    @property
    def measured_fraction(self) -> float:
        return float(self.measured.mean()) if len(self.measured) else 0.0

    def summary(self) -> dict:
        """Stage metrics for JobStageRun.metrics — the numbers a report
        leads with, and the coverage caveats that qualify them."""
        significant_distances = self.distance_m[self.significant]
        gained = significant_distances[significant_distances > 0]
        lost = significant_distances[significant_distances < 0]
        measured_lod = self.level_of_detection_m[self.measured]
        return {
            "corePoints": int(len(self.core_points)),
            "measuredFraction": round(self.measured_fraction, 4),
            "significantFraction": round(
                float(self.significant.sum() / max(1, int(self.measured.sum()))), 4
            ),
            "medianLevelOfDetectionM": _round_or_none(np.median(measured_lod) if len(measured_lod) else None),
            "maxLossM": _round_or_none(-lost.min() if len(lost) else 0.0),
            "maxGainM": _round_or_none(gained.max() if len(gained) else 0.0),
            "registrationErrorM": round(self.config.registration_error_m, 4),
            "confidenceLevel": self.confidence_level,
        }


def _round_or_none(value) -> float | None:
    return None if value is None else round(float(value), 4)


def estimate_normals(
    points: np.ndarray, query_points: np.ndarray, radius_m: float, up_hint: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Local-PCA surface normals at `query_points`, plus their neighbour counts.

    The normal is the smallest-variance direction of the neighbourhood, which
    is the plane-fit normal. Sign is resolved against `up_hint` so all
    normals point the same way out of the ground — without that, PCA's
    arbitrary per-point sign flips would randomly negate individual
    distances and make erosion and deposition indistinguishable.

    Degenerate neighbourhoods (too few points to define a plane) fall back
    to `up_hint` itself and are reported through the returned counts, for
    the caller to exclude.
    """
    tree = cKDTree(points)
    neighbourhoods = tree.query_ball_point(query_points, r=radius_m, workers=-1)

    up_hint = up_hint / np.linalg.norm(up_hint)
    normals = np.tile(up_hint, (len(query_points), 1))
    counts = np.zeros(len(query_points), dtype=np.int64)

    for i, indices in enumerate(neighbourhoods):
        counts[i] = len(indices)
        if len(indices) < 3:
            continue
        neighbourhood = points[indices]
        _, _, vt = np.linalg.svd(neighbourhood - neighbourhood.mean(axis=0), full_matrices=False)
        normals[i] = vt[-1]

    flip = np.einsum("ij,j->i", normals, up_hint) < 0
    normals[flip] *= -1.0
    return normals, counts


def _cylinder_projections(
    tree: cKDTree,
    points: np.ndarray,
    core_points: np.ndarray,
    normals: np.ndarray,
    config: ChangeConfig,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Mean and std of each cloud's surface position along each core point's
    normal, measured inside the M3C2 cylinder.

    Searched as a sphere then filtered to the cylinder: a KD-tree indexes
    spheres, and the enclosing sphere of the cylinder is the smallest region
    guaranteed to contain every cylinder member.
    """
    search_radius = float(np.hypot(config.cylinder_radius_m, config.cylinder_half_length_m))
    candidates = tree.query_ball_point(core_points, r=search_radius, workers=-1)

    means = np.full(len(core_points), np.nan)
    stds = np.full(len(core_points), np.nan)
    counts = np.zeros(len(core_points), dtype=np.int64)

    for i, indices in enumerate(candidates):
        if not len(indices):
            continue
        offsets = points[indices] - core_points[i]
        along = offsets @ normals[i]
        # Radial distance from the cylinder axis, via Pythagoras on the
        # full offset and its axial component — cheaper and better
        # conditioned than forming the perpendicular vector.
        radial_squared = np.maximum(np.einsum("ij,ij->i", offsets, offsets) - along ** 2, 0.0)
        inside = (radial_squared <= config.cylinder_radius_m ** 2) & (
            np.abs(along) <= config.cylinder_half_length_m
        )

        count = int(inside.sum())
        counts[i] = count
        if count < config.min_cylinder_points:
            continue
        inside_along = along[inside]
        means[i] = float(inside_along.mean())
        # Population std, matching the paper's roughness definition: this
        # describes the surface's own scatter, not an estimate of a sample
        # mean's error — the /sqrt(n) that turns it into the latter is
        # applied once, in the level-of-detection formula below.
        stds[i] = float(inside_along.std())

    return means, stds, counts


def compute_change(
    baseline_points: np.ndarray,
    repeat_points: np.ndarray,
    core_points: np.ndarray,
    config: ChangeConfig,
    up_hint: np.ndarray | None = None,
) -> ChangeField:
    """M3C2 distances from `baseline_points` to `repeat_points`.

    Both clouds must be in metres and already finely aligned (see
    register.align_captures) — this measures whatever offset remains, and
    cannot distinguish real movement from leftover misalignment.
    """
    if len(baseline_points) < config.min_cylinder_points:
        raise PipelineError(
            "geo:change",
            f"baseline capture has only {len(baseline_points)} surface points, too few to measure "
            "against",
        )
    if len(repeat_points) < config.min_cylinder_points:
        raise PipelineError(
            "geo:change",
            f"repeat capture has only {len(repeat_points)} surface points, too few to measure",
        )
    if not len(core_points):
        raise PipelineError("geo:change", "no core points supplied")

    # Normals come from the baseline: it is the reference surface, and using
    # the repeat capture's normals would make the measurement depend on the
    # very change being measured.
    up_hint = np.array([0.0, 0.0, 1.0]) if up_hint is None else np.asarray(up_hint, dtype=np.float64)
    normals, normal_counts = estimate_normals(
        baseline_points, core_points, config.normal_radius_m, up_hint
    )

    baseline_tree, repeat_tree = cKDTree(baseline_points), cKDTree(repeat_points)
    baseline_mean, baseline_std, baseline_count = _cylinder_projections(
        baseline_tree, baseline_points, core_points, normals, config
    )
    repeat_mean, repeat_std, repeat_count = _cylinder_projections(
        repeat_tree, repeat_points, core_points, normals, config
    )

    measured = (
        (normal_counts >= 3)
        & (baseline_count >= config.min_cylinder_points)
        & (repeat_count >= config.min_cylinder_points)
    )

    distance = np.full(len(core_points), np.nan)
    distance[measured] = repeat_mean[measured] - baseline_mean[measured]

    # Lague et al. eq. 2: the confidence interval on the difference of two
    # local surface means, plus the registration error as a systematic term.
    # Roughness is divided by sqrt(n) because each cylinder's mean is an
    # average of n samples — this is what lets a rough surface still resolve
    # small change when it is densely sampled.
    level_of_detection = np.full(len(core_points), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        level_of_detection[measured] = config.confidence_z * np.sqrt(
            baseline_std[measured] ** 2 / baseline_count[measured]
            + repeat_std[measured] ** 2 / repeat_count[measured]
        ) + config.registration_error_m

    significant = measured & (np.abs(distance) > level_of_detection)

    logger.info(
        "geo:change: %d core points, %.1f%% measured, %d significant (median LoD %.4f m)",
        len(core_points),
        measured.mean() * 100 if len(measured) else 0.0,
        int(significant.sum()),
        float(np.median(level_of_detection[measured])) if measured.any() else float("nan"),
    )
    return ChangeField(
        core_points=core_points,
        normal=normals,
        distance_m=distance,
        level_of_detection_m=level_of_detection,
        roughness_baseline_m=baseline_std,
        roughness_repeat_m=repeat_std,
        count_baseline=baseline_count,
        count_repeat=repeat_count,
        measured=measured,
        significant=significant,
        config=config,
    )
