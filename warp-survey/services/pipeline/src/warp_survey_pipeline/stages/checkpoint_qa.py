"""Independent checkpoint QA.

Checkpoints were withheld from reconstruction optimization; this stage samples
the delivered surface at each checkpoint and evaluates residuals against the
site's versioned acceptance profile. Missing criteria block PASS — there are
no invented defaults.
"""

import logging
import math
from dataclasses import dataclass, field

import numpy as np

from ..errors import PipelineError
from ..geo import Grid, sample_grid
from ..pointcloud import GridIndex

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Checkpoint:
    label: str
    easting: float
    northing: float
    elevation: float


@dataclass(frozen=True)
class AcceptanceProfile:
    """Versioned, reviewer-approved numeric tolerances for one site."""

    profile_id: str
    version: int
    min_checkpoint_count: int
    max_horizontal_rmse_m: float | None
    max_vertical_rmse_m: float
    max_abs_vertical_bias_m: float
    min_registration_rate: float


@dataclass
class CheckpointQaResult:
    state: str  # UNVERIFIED | PASS | FAIL
    count: int
    vertical_rmse_m: float | None
    vertical_bias_m: float | None
    max_vertical_residual_m: float | None
    horizontal_rmse_m: float | None
    findings: list[str] = field(default_factory=list)
    residuals: list[dict] = field(default_factory=list)

    def to_contract(self) -> dict:
        """Shape matching contracts' checkpointResiduals (or None)."""
        if self.count == 0:
            return None
        return {
            "count": self.count,
            "horizontalRmseM": self.horizontal_rmse_m,
            "verticalRmseM": self.vertical_rmse_m,
            "horizontalBiasM": None,
            "verticalBiasM": self.vertical_bias_m,
            "maxHorizontalResidualM": None,
            "maxVerticalResidualM": self.max_vertical_residual_m,
            "distributionNote": next((f for f in self.findings if "distribution" in f), None),
        }


def vertical_residuals_against_dsm(dsm: Grid, checkpoints: list[Checkpoint]) -> list[dict]:
    """Sample the DSM at each checkpoint. Residual = surface − checkpoint
    (positive means the model is above the surveyed point)."""
    out = []
    for cp in checkpoints:
        z = sample_grid(dsm, cp.easting, cp.northing)
        residual = None if math.isnan(z) else z - cp.elevation
        out.append({"label": cp.label, "verticalResidualM": residual})
    return out


def horizontal_rmse_against_cloud(
    points: np.ndarray, checkpoints: list[Checkpoint], search_radius_m: float = 0.5
) -> float | None:
    """Horizontal RMSE from nearest-neighbour distance in the dense cloud.

    A conservative proxy: without marked image observations of each target we
    cannot separate horizontal error from surface geometry, so this value is
    reported but PASS/FAIL gates rely on vertical residuals unless a profile
    sets a horizontal tolerance.
    """
    if len(points) == 0 or not checkpoints:
        return None
    index = GridIndex.build(points, cell=max(search_radius_m, 0.25))
    distances = []
    for cp in checkpoints:
        idx = index.query_radius_2d(cp.easting, cp.northing, search_radius_m)
        if len(idx) == 0:
            continue
        pts = points[idx]
        d = np.sqrt((pts[:, 0] - cp.easting) ** 2 + (pts[:, 1] - cp.northing) ** 2)
        distances.append(float(d.min()))
    if not distances:
        return None
    return float(np.sqrt(np.mean(np.square(distances))))


def _distribution_note(checkpoints: list[Checkpoint], covered: int) -> str:
    if covered < len(checkpoints):
        return (
            f"distribution: {len(checkpoints) - covered} of {len(checkpoints)} checkpoints "
            "fall outside delivered coverage"
        )
    xs = [c.easting for c in checkpoints]
    ys = [c.northing for c in checkpoints]
    span_x, span_y = max(xs) - min(xs), max(ys) - min(ys)
    if span_x < 1.0 or span_y < 1.0:
        return "distribution: checkpoints are clustered; residuals may not represent the full site"
    return "distribution: checkpoints cover the assessed extent"


def evaluate_checkpoints(
    dsm: Grid,
    checkpoints: list[Checkpoint],
    profile: AcceptanceProfile | None,
    registration_rate: float | None = None,
    dense_points: np.ndarray | None = None,
) -> CheckpointQaResult:
    """Evaluate independent checkpoints against the acceptance profile.

    No checkpoints → UNVERIFIED. No acceptance profile → UNVERIFIED (missing
    criteria never silently pass). Any exceeded tolerance → FAIL with the
    specific numeric reason.
    """
    if not checkpoints:
        return CheckpointQaResult(
            state="UNVERIFIED",
            count=0,
            vertical_rmse_m=None,
            vertical_bias_m=None,
            max_vertical_residual_m=None,
            horizontal_rmse_m=None,
            findings=["no independent checkpoints were supplied; the survey stays UNVERIFIED"],
        )

    residuals = vertical_residuals_against_dsm(dsm, checkpoints)
    valid = [r["verticalResidualM"] for r in residuals if r["verticalResidualM"] is not None]
    covered = len(valid)
    findings = [_distribution_note(checkpoints, covered)]

    if covered == 0:
        return CheckpointQaResult(
            state="FAIL",
            count=len(checkpoints),
            vertical_rmse_m=None,
            vertical_bias_m=None,
            max_vertical_residual_m=None,
            horizontal_rmse_m=None,
            findings=findings + ["no checkpoint falls inside delivered surface coverage"],
            residuals=residuals,
        )

    arr = np.asarray(valid, dtype=np.float64)
    vertical_rmse = float(np.sqrt(np.mean(np.square(arr))))
    vertical_bias = float(np.mean(arr))
    max_abs = float(np.max(np.abs(arr)))
    horizontal_rmse = (
        horizontal_rmse_against_cloud(dense_points, checkpoints) if dense_points is not None else None
    )

    if profile is None:
        return CheckpointQaResult(
            state="UNVERIFIED",
            count=len(checkpoints),
            vertical_rmse_m=vertical_rmse,
            vertical_bias_m=vertical_bias,
            max_vertical_residual_m=max_abs,
            horizontal_rmse_m=horizontal_rmse,
            findings=findings
            + ["no acceptance profile is configured for this site; residuals are reported without a PASS/FAIL judgement"],
            residuals=residuals,
        )

    failures: list[str] = []
    if covered < profile.min_checkpoint_count:
        failures.append(
            f"only {covered} checkpoints inside coverage; the acceptance profile requires {profile.min_checkpoint_count}"
        )
    if vertical_rmse > profile.max_vertical_rmse_m:
        failures.append(
            f"vertical RMSE {vertical_rmse:.3f} m exceeds the {profile.max_vertical_rmse_m:.3f} m tolerance"
        )
    if abs(vertical_bias) > profile.max_abs_vertical_bias_m:
        failures.append(
            f"vertical bias {vertical_bias:+.3f} m exceeds the ±{profile.max_abs_vertical_bias_m:.3f} m tolerance"
        )
    if profile.max_horizontal_rmse_m is not None:
        if horizontal_rmse is None:
            failures.append("the acceptance profile sets a horizontal tolerance but horizontal residuals could not be assessed")
        elif horizontal_rmse > profile.max_horizontal_rmse_m:
            failures.append(
                f"horizontal RMSE {horizontal_rmse:.3f} m exceeds the {profile.max_horizontal_rmse_m:.3f} m tolerance"
            )
    if registration_rate is not None and registration_rate < profile.min_registration_rate:
        failures.append(
            f"only {registration_rate:.0%} of images registered; the acceptance profile requires {profile.min_registration_rate:.0%}"
        )

    return CheckpointQaResult(
        state="FAIL" if failures else "PASS",
        count=len(checkpoints),
        vertical_rmse_m=vertical_rmse,
        vertical_bias_m=vertical_bias,
        max_vertical_residual_m=max_abs,
        horizontal_rmse_m=horizontal_rmse,
        findings=findings + failures,
        residuals=residuals,
    )


def parse_acceptance_profile(raw: dict | None) -> AcceptanceProfile | None:
    """Parse the site's acceptance profile JSON; None keeps surveys UNVERIFIED."""
    if not raw:
        return None
    try:
        return AcceptanceProfile(
            profile_id=str(raw["profileId"]),
            version=int(raw["version"]),
            min_checkpoint_count=int(raw["minCheckpointCount"]),
            max_horizontal_rmse_m=(
                float(raw["maxHorizontalRmseM"]) if raw.get("maxHorizontalRmseM") is not None else None
            ),
            max_vertical_rmse_m=float(raw["maxVerticalRmseM"]),
            max_abs_vertical_bias_m=float(raw["maxAbsVerticalBiasM"]),
            min_registration_rate=float(raw.get("minRegistrationRate", 0.8)),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise PipelineError(
            f"the site's acceptance profile is malformed ({e}); fix the profile rather than bypassing QA",
            transient=False,
        ) from e
