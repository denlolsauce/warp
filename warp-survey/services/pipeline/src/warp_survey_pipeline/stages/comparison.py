"""Change computation between two approved survey revisions.

Sign convention (fixed): change = later minus earlier; positive = fill,
negative = cut. Volume uncertainty accounts for spatially correlated error —
never a sqrt(N) reduction that assumes independent cells.
"""

import logging
import math
from dataclasses import dataclass, field

import numpy as np

from ..errors import PipelineError
from ..geo import Grid, crs_is_compatible, harmonize_grids
from ..pointcloud import GridIndex, estimate_normal

logger = logging.getLogger(__name__)

SIGN_CONVENTION = (
    "Elevation change is later minus earlier. Positive values indicate fill; "
    "negative values indicate cut."
)


# --- compatibility gates -----------------------------------------------------

@dataclass(frozen=True)
class EpochInputs:
    """What a comparison needs to know about one epoch."""

    revision_id: str
    crs: str
    vertical_datum_id: str
    measurement_state: str  # UNVERIFIED | PASS | FAIL
    vertical_rmse_m: float | None


def check_compatibility(baseline: EpochInputs, candidate: EpochInputs) -> list[str]:
    """Hard gates before any change computation. Returns failure reasons."""
    failures = []
    if baseline.revision_id == candidate.revision_id:
        failures.append("baseline and candidate are the same revision; a comparison requires two distinct epochs")
    if not crs_is_compatible(baseline.crs, candidate.crs):
        failures.append(
            f"horizontal reference mismatch: {baseline.crs} vs {candidate.crs}; reprojecting between epochs is not supported"
        )
    if baseline.vertical_datum_id != candidate.vertical_datum_id:
        failures.append(
            f"vertical datum mismatch: {baseline.vertical_datum_id} vs {candidate.vertical_datum_id}; "
            "apparent elevation change would be a datum artifact"
        )
    for name, epoch in (("baseline", baseline), ("candidate", candidate)):
        if epoch.measurement_state == "FAIL":
            failures.append(f"the {name} revision failed measurement QA and cannot anchor a comparison")
    return failures


def comparison_is_exploratory(baseline: EpochInputs, candidate: EpochInputs) -> tuple[bool, list[str]]:
    """UNVERIFIED epochs or unassessable uncertainty keep a comparison
    exploratory — computable, but ineligible for engineering approval."""
    notes = []
    for name, epoch in (("baseline", baseline), ("candidate", candidate)):
        if epoch.measurement_state == "UNVERIFIED":
            notes.append(f"the {name} revision is UNVERIFIED; the comparison stays exploratory")
        if epoch.vertical_rmse_m is None:
            notes.append(f"the {name} revision has no assessed vertical uncertainty")
    return (len(notes) > 0, notes)


# --- elevation differencing --------------------------------------------------

@dataclass
class ElevationDifferencingOutput:
    change: Grid  # later minus earlier, NaN outside common valid coverage
    cut_volume_m3: float
    fill_volume_m3: float
    net_volume_m3: float
    affected_area_m2: float
    detection_threshold_m: float | None
    volume_uncertainty_m3: float | None
    below_threshold_masked_fraction: float
    findings: list[str] = field(default_factory=list)


def detection_threshold(baseline_rmse: float | None, candidate_rmse: float | None, k: float = 1.96) -> float | None:
    """Propagated level-of-detection: k·sqrt(σ₁² + σ₂²). None if either
    epoch's uncertainty is unassessed."""
    if baseline_rmse is None or candidate_rmse is None:
        return None
    return k * math.sqrt(baseline_rmse**2 + candidate_rmse**2)


def elevation_differencing(
    earlier: Grid,
    later: Grid,
    baseline_rmse_m: float | None,
    candidate_rmse_m: float | None,
    aoi: tuple[float, float, float, float] | None = None,
) -> ElevationDifferencingOutput:
    """Difference two DSMs on a harmonized common grid.

    Cells below the detection threshold are masked from volume totals and
    reported as a masked fraction. Volume uncertainty treats the elevation
    error as fully correlated across the affected area (conservative):
    σ_V = LoD/k · A_affected.
    """
    ge, gl = harmonize_grids(earlier, later)
    diff = gl.data - ge.data  # later minus earlier

    if aoi is not None:
        h, w = diff.shape
        xs = ge.transform.c + (np.arange(w) + 0.5) * ge.transform.a
        ys = ge.transform.f + (np.arange(h) + 0.5) * ge.transform.e
        xmask = (xs >= aoi[0]) & (xs <= aoi[2])
        ymask = (ys >= aoi[1]) & (ys <= aoi[3])
        outside = ~(ymask[:, None] & xmask[None, :])
        diff[outside] = np.nan

    valid = ~np.isnan(diff)
    cell_area = ge.resolution * ge.resolution
    findings: list[str] = []

    lod = detection_threshold(baseline_rmse_m, candidate_rmse_m)
    if lod is None:
        significant = valid
        masked_fraction = 0.0
        findings.append(
            "epoch uncertainty could not be assessed; no detection threshold was applied and the comparison is exploratory"
        )
    else:
        significant = valid & (np.abs(diff) >= lod)
        n_valid = int(valid.sum())
        masked_fraction = float((valid & ~significant).sum() / n_valid) if n_valid else 0.0

    fill = float(np.nansum(np.where(significant & (diff > 0), diff, 0.0)) * cell_area)
    cut = float(-np.nansum(np.where(significant & (diff < 0), diff, 0.0)) * cell_area)
    affected_area = float(significant.sum() * cell_area)

    if lod is not None and affected_area > 0:
        # Fully correlated error over the affected area: σ_V = σ_z · A.
        sigma_z = lod / 1.96
        volume_uncertainty = sigma_z * affected_area
    else:
        volume_uncertainty = None

    change = Grid(data=np.where(valid, diff, np.nan), transform=ge.transform, crs=ge.crs)
    return ElevationDifferencingOutput(
        change=change,
        cut_volume_m3=cut,
        fill_volume_m3=fill,
        net_volume_m3=fill - cut,
        affected_area_m2=affected_area,
        detection_threshold_m=lod,
        volume_uncertainty_m3=volume_uncertainty,
        below_threshold_masked_fraction=masked_fraction,
        findings=findings,
    )


# --- M3C2 ---------------------------------------------------------------------

@dataclass
class M3c2Output:
    core_points: np.ndarray  # (N, 3) core point positions
    distances: np.ndarray  # (N,) signed distances, NaN where not computable
    significant: np.ndarray  # (N,) bool, |d| >= per-point LoD
    lod: np.ndarray  # (N,) per-point level of detection (NaN when unassessable)
    parameters: dict
    mean_signed_distance_m: float
    significant_change_fraction: float
    findings: list[str] = field(default_factory=list)


def m3c2(
    earlier: np.ndarray,
    later: np.ndarray,
    normal_radius: float,
    projection_radius: float,
    max_depth: float,
    registration_error_m: float = 0.0,
    core_spacing: float | None = None,
) -> M3c2Output:
    """M3C2 signed surface distances (Lague et al. 2013) between two clouds.

    Distances are surface change along the local baseline normal — they are
    never displacement vectors and never a stability result. Per-point LoD is
    1.96·sqrt(σ₁²/n₁ + σ₂²/n₂) + registration error.
    """
    if len(earlier) == 0 or len(later) == 0:
        raise PipelineError("both epochs need a non-empty point cloud for M3C2", transient=False)

    spacing = core_spacing or projection_radius
    # Subsample core points on a uniform grid from the earlier epoch.
    core_index = GridIndex.build(earlier, cell=spacing)
    core_points = np.array(
        [earlier[idx[0]] for idx in core_index.cells.values()], dtype=np.float64
    )

    earlier_idx = GridIndex.build(earlier, cell=max(normal_radius, projection_radius))
    later_idx = GridIndex.build(later, cell=max(normal_radius, projection_radius))

    n = len(core_points)
    distances = np.full(n, np.nan)
    lod = np.full(n, np.nan)

    for i, cp in enumerate(core_points):
        nb = earlier_idx.query_radius_2d(cp[0], cp[1], normal_radius)
        if len(nb) < 4:
            continue
        normal = estimate_normal(earlier[nb])

        d1 = _projected_offsets(earlier, earlier_idx, cp, normal, projection_radius, max_depth)
        d2 = _projected_offsets(later, later_idx, cp, normal, projection_radius, max_depth)
        if len(d1) < 4 or len(d2) < 4:
            continue

        m1, m2 = float(np.mean(d1)), float(np.mean(d2))
        distances[i] = m2 - m1  # later minus earlier along the normal
        s1 = float(np.var(d1, ddof=1)) if len(d1) > 1 else 0.0
        s2 = float(np.var(d2, ddof=1)) if len(d2) > 1 else 0.0
        lod[i] = 1.96 * math.sqrt(s1 / len(d1) + s2 / len(d2)) + registration_error_m

    computed = ~np.isnan(distances)
    significant = computed & (np.abs(distances) >= lod)
    findings = []
    if computed.sum() == 0:
        raise PipelineError(
            "M3C2 could not compute any distances — the epochs may not overlap or point density is too low",
            transient=False,
        )
    frac_uncomputed = 1.0 - computed.sum() / n
    if frac_uncomputed > 0.5:
        findings.append(
            f"{frac_uncomputed:.0%} of core points had insufficient neighbours; interpret coverage carefully"
        )

    return M3c2Output(
        core_points=core_points,
        distances=distances,
        significant=significant,
        lod=lod,
        parameters={
            "normalRadiusM": normal_radius,
            "projectionRadiusM": projection_radius,
            "maxDepthM": max_depth,
            "registrationErrorM": registration_error_m,
            "coreSpacingM": spacing,
            "corePointCount": int(n),
        },
        mean_signed_distance_m=float(np.nanmean(distances)),
        significant_change_fraction=float(significant.sum() / computed.sum()),
        findings=findings,
    )


def _projected_offsets(
    cloud: np.ndarray,
    index: GridIndex,
    core: np.ndarray,
    normal: np.ndarray,
    radius: float,
    max_depth: float,
) -> np.ndarray:
    """Signed offsets along `normal` of points inside the projection cylinder."""
    # Horizontal pre-filter is conservative for tilted cylinders.
    reach = math.hypot(radius, max_depth)
    nb = index.query_radius_2d(float(core[0]), float(core[1]), reach)
    if len(nb) == 0:
        return np.empty(0)
    rel = cloud[nb] - core
    along = rel @ normal
    radial = rel - np.outer(along, normal)
    r2 = np.einsum("ij,ij->i", radial, radial)
    mask = (r2 <= radius * radius) & (np.abs(along) <= max_depth)
    return along[mask]


# --- rigid registration on stable areas ---------------------------------------

def estimate_rigid_registration(
    moving: np.ndarray, fixed: np.ndarray
) -> tuple[np.ndarray, float]:
    """Least-squares rigid transform (Kabsch/Umeyama, no scale) from paired
    stable-area points. Returns (4x4 matrix, RMSE after alignment).

    Only ever fit on approved stable areas — aligning the changing surface
    would remove real movement.
    """
    if moving.shape != fixed.shape or len(moving) < 3:
        raise PipelineError("rigid registration needs at least 3 paired stable points", transient=False)
    mu_m, mu_f = moving.mean(axis=0), fixed.mean(axis=0)
    h = (moving - mu_m).T @ (fixed - mu_f)
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    s = np.diag([1.0, 1.0, d])
    rotation = vt.T @ s @ u.T
    translation = mu_f - rotation @ mu_m
    matrix = np.eye(4)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = translation
    aligned = moving @ rotation.T + translation
    rmse = float(np.sqrt(np.mean(np.sum((aligned - fixed) ** 2, axis=1))))
    return matrix, rmse
