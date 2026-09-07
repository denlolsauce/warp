"""The stage that runs the whole comparison and writes the report.

Takes a baseline capture, a repeat capture and their ground control points;
produces one JSON document that is the survey deliverable: what was
measured, how precisely, what moved, by how much, and where to inspect.

Two things it deliberately does not do. It does not decide whether the site
is safe — every number carries its own error bar and the engineer signing
the report owns the interpretation. And it does not hide a poor survey
behind a confident-looking document: coverage, registration error and the
median level of detection are top-level fields, so a report built on a bad
alignment says so on its own face.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ..errors import PipelineError
from .change import ChangeConfig, ChangeField, compute_change
from .cloud import load_surface_points, median_point_spacing
from .clusters import ChangeCluster, cluster_significant_change
from .georeference import GroundControlPoint, SimilarityTransform, fit_similarity_transform
from .register import CaptureAlignment, align_captures
from .volume import VolumeEstimate, planar_grid_volume

logger = logging.getLogger(__name__)

REPORT_VERSION = 1
# Core points are a subsample of the baseline: M3C2 distances at full
# density cost time proportional to the cloud and buy nothing, because
# neighbouring core points inside one cylinder radius are already averaging
# the same source points. 3x the point spacing keeps cores comfortably
# denser than the cylinder radius (6x) so no real feature falls between them.
CORE_POINT_SPACING_MULTIPLE = 3.0


@dataclass(frozen=True)
class SurveyResult:
    field: ChangeField
    clusters: list[ChangeCluster]
    site_volume: VolumeEstimate
    baseline_georeference: SimilarityTransform
    repeat_georeference: SimilarityTransform
    alignment: CaptureAlignment
    point_spacing_m: float
    up_axis: np.ndarray

    def as_report(self, *, baseline_label: str, repeat_label: str) -> dict:
        return {
            "version": REPORT_VERSION,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "baseline": baseline_label,
            "repeat": repeat_label,
            "method": {
                "changeDetection": "M3C2 (Lague, Brodu & Leroux 2013)",
                "georeferencing": "Umeyama similarity fit to ground control points",
                "fineAlignment": "trimmed rigid ICP on the unchanged surface",
                "pointSpacingM": round(self.point_spacing_m, 4),
                "normalRadiusM": round(self.field.config.normal_radius_m, 4),
                "cylinderRadiusM": round(self.field.config.cylinder_radius_m, 4),
                "cylinderHalfLengthM": round(self.field.config.cylinder_half_length_m, 4),
                "upAxis": [round(float(v), 6) for v in self.up_axis],
            },
            # Everything a reviewer needs to decide whether to trust the
            # findings below, before reading them.
            "precision": {
                "baselineControlRmseM": round(self.baseline_georeference.rmse_m, 4),
                "repeatControlRmseM": round(self.repeat_georeference.rmse_m, 4),
                "registrationRmseM": round(self.alignment.rmse_m, 4),
                "registrationConverged": self.alignment.converged,
                "registrationInlierCount": self.alignment.inlier_count,
                "scaleMPerUnit": {
                    "baseline": round(self.baseline_georeference.scale, 6),
                    "repeat": round(self.repeat_georeference.scale, 6),
                },
            },
            "change": self.field.summary(),
            "siteVolume": self.site_volume.as_dict(),
            "findings": [cluster.as_dict() for cluster in self.clusters],
        }


def subsample_core_points(points: np.ndarray, spacing_m: float) -> np.ndarray:
    """Voxel-decimate to one point per `spacing_m` cell, taking the point
    nearest each occupied cell's centre.

    Nearest-to-centre rather than the cell mean: a mean of points straddling
    a bench edge sits in mid-air, off the surface entirely, and M3C2 would
    then measure from a location that has no surface at it.
    """
    if spacing_m <= 0:
        raise PipelineError("geo:survey", f"core point spacing must be positive, got {spacing_m}")

    cells = np.floor(points / spacing_m).astype(np.int64)
    _, inverse = np.unique(cells, axis=0, return_inverse=True)
    cell_centres = (cells + 0.5) * spacing_m
    offsets = np.linalg.norm(points - cell_centres, axis=1)

    order = np.lexsort((offsets, inverse))
    first_in_cell = np.ones(len(order), dtype=bool)
    first_in_cell[1:] = inverse[order][1:] != inverse[order][:-1]
    return points[order[first_in_cell]]


def run_survey(
    baseline_ply: Path,
    repeat_ply: Path,
    baseline_control_points: list[GroundControlPoint],
    repeat_control_points: list[GroundControlPoint],
    up_axis: np.ndarray | None = None,
) -> SurveyResult:
    """Compare two captures of the same ground, in metres."""
    up_axis = np.array([0.0, 0.0, 1.0]) if up_axis is None else np.asarray(up_axis, dtype=np.float64)

    baseline_transform = fit_similarity_transform(baseline_control_points)
    repeat_transform = fit_similarity_transform(repeat_control_points)

    baseline_points = baseline_transform.apply(load_surface_points(baseline_ply))
    repeat_points = repeat_transform.apply(load_surface_points(repeat_ply))

    # Spacing from the baseline alone: it defines the reference surface, and
    # a repeat capture flown at a different height would otherwise change
    # every derived radius and make two surveys of the same site
    # incomparable.
    point_spacing = median_point_spacing(baseline_points)
    logger.info("geo:survey: baseline point spacing %.4f m", point_spacing)

    alignment = align_captures(repeat_points, baseline_points, point_spacing)
    aligned_repeat = alignment.apply(repeat_points)

    core_points = subsample_core_points(baseline_points, point_spacing * CORE_POINT_SPACING_MULTIPLE)
    logger.info("geo:survey: %d core points from %d baseline points", len(core_points), len(baseline_points))

    # The registration RMSE, not the GCP RMSE, is the error that limits
    # change detection: both captures were aligned onto the same surface, so
    # their shared georeferencing offset cancels out of the difference and
    # only the residual misalignment remains.
    config = ChangeConfig.from_point_spacing(point_spacing, alignment.rmse_m)
    field = compute_change(baseline_points, aligned_repeat, core_points, config, up_hint=up_axis)

    clusters = cluster_significant_change(field, plane_normal=up_axis)
    site_volume = planar_grid_volume(field, plane_normal=up_axis)

    return SurveyResult(
        field=field,
        clusters=clusters,
        site_volume=site_volume,
        baseline_georeference=baseline_transform,
        repeat_georeference=repeat_transform,
        alignment=alignment,
        point_spacing_m=point_spacing,
        up_axis=up_axis,
    )


def load_control_points(path: Path) -> list[GroundControlPoint]:
    """Read a GCP file: {"points": [{"label", "local": [x,y,z], "world": [e,n,h]}]}."""
    if not path.is_file():
        raise PipelineError("geo:survey", f"ground control point file not found: {path}")
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise PipelineError("geo:survey", f"{path.name} is not valid JSON: {error}") from error

    entries = raw.get("points") if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise PipelineError(
            "geo:survey",
            f"{path.name} must contain a list of control points (or an object with a 'points' list)",
        )

    points = []
    for index, entry in enumerate(entries):
        try:
            local, world = entry["local"], entry["world"]
            if len(local) != 3 or len(world) != 3:
                raise ValueError("expected 3 coordinates")
            points.append(
                GroundControlPoint(
                    local=(float(local[0]), float(local[1]), float(local[2])),
                    world=(float(world[0]), float(world[1]), float(world[2])),
                    label=str(entry.get("label", f"GCP{index + 1}")),
                )
            )
        except (KeyError, TypeError, ValueError) as error:
            raise PipelineError(
                "geo:survey",
                f"control point {index + 1} in {path.name} is malformed ({error}) — each needs a "
                "'local' [x, y, z] in reconstruction units and a 'world' [easting, northing, "
                "height] in metres",
            ) from error
    return points


def write_survey_report(result: SurveyResult, out_path: Path, *, baseline_label: str, repeat_label: str) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(result.as_report(baseline_label=baseline_label, repeat_label=repeat_label), indent=2)
    )
    logger.info("geo:survey: report written to %s", out_path)
    return out_path


def run_monitor(
    workdir: Path,
    baseline_ply: Path,
    repeat_ply: Path,
    baseline_control_path: Path,
    repeat_control_path: Path,
) -> Path:
    """Stage entry point: compare two captures and persist the report.

    Signature mirrors the other stages (a workdir plus its inputs, returning
    the artifact path) so this is resumable and re-runnable the same way —
    the report is derived entirely from its inputs, so re-running it after a
    crash recomputes exactly the same document.
    """
    result = run_survey(
        baseline_ply,
        repeat_ply,
        load_control_points(baseline_control_path),
        load_control_points(repeat_control_path),
    )
    return write_survey_report(
        result,
        workdir / "survey" / "change-report.json",
        baseline_label=baseline_ply.stem,
        repeat_label=repeat_ply.stem,
    )
