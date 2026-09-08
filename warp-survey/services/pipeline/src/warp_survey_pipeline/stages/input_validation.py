"""Input validation and capture QA (first measurement stage).

Validates the acquisition contract before any GPU or SfM time is spent:
imagery present and readable, EXIF/positions consistent, control points in
the declared CRS's plausible range, and checkpoints distinct from GCPs.
"""

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

from ..errors import PipelineError

logger = logging.getLogger(__name__)

SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".tif", ".tiff"}
MIN_IMAGE_COUNT = 20


@dataclass(frozen=True)
class ControlPointInput:
    label: str
    role: str  # GCP | CHECKPOINT
    easting: float
    northing: float
    elevation: float
    observations: list[dict] | None = None


@dataclass
class ValidationResult:
    image_count: int
    has_camera_positions: bool
    gcp_count: int
    checkpoint_count: int
    warnings: list[str] = field(default_factory=list)


def validate_inputs(
    image_paths: list[Path],
    camera_positions: dict[str, tuple],
    control_points: list[ControlPointInput],
) -> ValidationResult:
    """Validate the survey's inputs. Raises PipelineError (non-transient) with
    a specific reason on hard failures; soft issues become warnings."""
    warnings: list[str] = []

    if len(image_paths) < MIN_IMAGE_COUNT:
        raise PipelineError(
            f"only {len(image_paths)} images were supplied; a measurable survey needs at least {MIN_IMAGE_COUNT}",
            transient=False,
        )

    bad_suffix = [p.name for p in image_paths if p.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES]
    if bad_suffix:
        raise PipelineError(
            f"unsupported image formats: {', '.join(bad_suffix[:5])}"
            + ("…" if len(bad_suffix) > 5 else "")
            + " — the measurement branch requires original JPEG/TIFF stills, not video frames",
            transient=False,
        )

    missing = [p.name for p in image_paths if not p.exists() or p.stat().st_size == 0]
    if missing:
        raise PipelineError(
            f"missing or empty image files: {', '.join(missing[:5])}" + ("…" if len(missing) > 5 else ""),
            transient=False,
        )

    if camera_positions:
        names = {p.name for p in image_paths}
        orphaned = set(camera_positions) - names
        if orphaned:
            warnings.append(
                f"{len(orphaned)} camera positions reference images not in the upload and were ignored"
            )
        without = names - set(camera_positions)
        if without:
            warnings.append(f"{len(without)} images have no corrected camera position")
    else:
        warnings.append("no RTK/PPK camera positions supplied; georeferencing relies entirely on ground control")

    gcps = [c for c in control_points if c.role == "GCP"]
    checkpoints = [c for c in control_points if c.role == "CHECKPOINT"]

    if not gcps and not camera_positions:
        raise PipelineError(
            "no ground control points and no corrected camera positions — the survey cannot be georeferenced",
            transient=False,
        )

    unmarked_gcps = [g.label for g in gcps if not g.observations]
    if unmarked_gcps:
        raise PipelineError(
            f"GCPs {', '.join(unmarked_gcps[:5])} have no image observations; mark each control point "
            "in at least one uploaded image before reconstruction",
            transient=False,
        )

    # A point used for control must not double as an independent check.
    gcp_coords = {(round(g.easting, 3), round(g.northing, 3), round(g.elevation, 3)) for g in gcps}
    overlapping = [
        c.label
        for c in checkpoints
        if (round(c.easting, 3), round(c.northing, 3), round(c.elevation, 3)) in gcp_coords
    ]
    if overlapping:
        raise PipelineError(
            f"checkpoints {', '.join(overlapping)} share coordinates with GCPs; independent checkpoints "
            "must be withheld from optimization, not reused control points",
            transient=False,
        )

    for c in control_points:
        if not all(math.isfinite(v) for v in (c.easting, c.northing, c.elevation)):
            raise PipelineError(f"control point {c.label} has non-finite coordinates", transient=False)

    if not checkpoints:
        warnings.append("no independent checkpoints supplied; the survey will remain UNVERIFIED")
    elif len(checkpoints) < 3:
        warnings.append(f"only {len(checkpoints)} independent checkpoints; residual statistics will be weak")

    return ValidationResult(
        image_count=len(image_paths),
        has_camera_positions=bool(camera_positions),
        gcp_count=len(gcps),
        checkpoint_count=len(checkpoints),
        warnings=warnings,
    )
