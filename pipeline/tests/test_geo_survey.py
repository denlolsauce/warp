import json

import numpy as np
import pytest

from geo_fixtures import displace_disc, slope_surface
from ply_fixtures import write_gaussian_ply_at_positions
from splat_pipeline.errors import PipelineError
from splat_pipeline.geo.survey import (
    load_control_points,
    run_monitor,
    run_survey,
    subsample_core_points,
    write_survey_report,
)

OPAQUE_LOGIT = float(np.log(0.9 / 0.1))
# The survey runs in local reconstruction units and is georeferenced by the
# GCPs, exactly as a real job does. 0.4 units/metre means the synthetic
# clouds below are 8 units across and 20 m across, so every reported number
# has to come out of the georeferencing rather than by accident.
UNITS_PER_METRE = 0.4


def write_capture(path, points_m):
    """Persist a metre-space cloud as a splat PLY in local units."""
    local = points_m * UNITS_PER_METRE
    write_gaussian_ply_at_positions(path, [tuple(p) for p in local], opacity_logit=OPAQUE_LOGIT)
    return path


def control_points_json(path, world_points):
    """GCPs tying local units back to the metre grid the clouds came from."""
    path.write_text(
        json.dumps(
            {
                "points": [
                    {
                        "label": f"GCP{i + 1}",
                        "local": [float(v * UNITS_PER_METRE) for v in point],
                        "world": [float(v) for v in point],
                    }
                    for i, point in enumerate(world_points)
                ]
            }
        )
    )
    return path


CONTROL_LAYOUT = np.array([[0.0, 0.0, 0.0], [18.0, 1.0, 9.0], [1.0, 18.0, 0.5], [15.0, 16.0, 7.5]])


# ---------------------------------------------------------------------------
# subsample_core_points
# ---------------------------------------------------------------------------


def test_core_points_thin_the_cloud_to_roughly_one_per_cell():
    points = slope_surface(n=20000, extent_m=20.0, seed=100)

    cores = subsample_core_points(points, 1.0)

    assert len(cores) < len(points) / 5
    # Cells are 3D, so a 20x20 m slope gives somewhat more than its 400
    # footprint cells: where the surface crosses a vertical cell boundary
    # both cells are occupied. That is the intended behaviour — a 3D
    # decimation follows a vertical face, whereas a footprint grid would
    # collapse one to a single core point.
    assert 400 <= len(cores) < 700


def test_core_points_lie_on_the_surface_not_between_it():
    # Taking each cell's mean instead would place cores in mid-air across a
    # bench edge, where M3C2 would measure from a location with no surface.
    upper = np.column_stack([np.linspace(0, 4, 500), np.zeros(500), np.full(500, 5.0)])
    lower = np.column_stack([np.linspace(0, 4, 500), np.zeros(500), np.zeros(500)])
    points = np.vstack([upper, lower])

    cores = subsample_core_points(points, 10.0)  # one cell spanning both faces

    assert len(cores) == 1
    assert np.isclose(cores[0][2], 0.0) or np.isclose(cores[0][2], 5.0)


def test_core_point_spacing_must_be_positive():
    with pytest.raises(PipelineError) as excinfo:
        subsample_core_points(slope_surface(n=100), 0.0)
    assert "must be positive" in str(excinfo.value)


# ---------------------------------------------------------------------------
# load_control_points
# ---------------------------------------------------------------------------


def test_reads_a_control_point_file(tmp_path):
    path = control_points_json(tmp_path / "gcps.json", CONTROL_LAYOUT)

    points = load_control_points(path)

    assert len(points) == 4
    assert points[0].label == "GCP1"
    assert np.allclose(points[1].world, CONTROL_LAYOUT[1])


def test_accepts_a_bare_list_of_control_points(tmp_path):
    path = tmp_path / "gcps.json"
    path.write_text(json.dumps([{"local": [0, 0, 0], "world": [1, 2, 3]}] * 3))

    assert len(load_control_points(path)) == 3


def test_malformed_control_point_names_the_offending_entry(tmp_path):
    path = tmp_path / "gcps.json"
    path.write_text(json.dumps({"points": [{"local": [0, 0, 0], "world": [1, 2, 3]}, {"local": [0, 0]}]}))

    with pytest.raises(PipelineError) as excinfo:
        load_control_points(path)
    assert "control point 2" in str(excinfo.value)
    assert "easting" in str(excinfo.value)


def test_invalid_json_fails_with_the_filename(tmp_path):
    path = tmp_path / "gcps.json"
    path.write_text("{not json")

    with pytest.raises(PipelineError) as excinfo:
        load_control_points(path)
    assert "gcps.json is not valid JSON" in str(excinfo.value)


def test_missing_control_point_file_fails_loudly(tmp_path):
    with pytest.raises(PipelineError) as excinfo:
        load_control_points(tmp_path / "absent.json")
    assert "not found" in str(excinfo.value)


# ---------------------------------------------------------------------------
# run_survey end to end
# ---------------------------------------------------------------------------


def test_survey_recovers_a_known_movement_in_metres(tmp_path):
    baseline_m = slope_surface(n=20000, extent_m=20.0, seed=110)
    repeat_m = displace_disc(baseline_m, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=-0.40)

    result = run_survey(
        write_capture(tmp_path / "baseline.ply", baseline_m),
        write_capture(tmp_path / "repeat.ply", repeat_m),
        load_control_points(control_points_json(tmp_path / "base_gcp.json", CONTROL_LAYOUT)),
        load_control_points(control_points_json(tmp_path / "repeat_gcp.json", CONTROL_LAYOUT)),
    )

    # Scale must be recovered as 1/UNITS_PER_METRE metres per unit, or every
    # distance below is in the wrong unit.
    assert np.isclose(result.baseline_georeference.scale, 1 / UNITS_PER_METRE, rtol=1e-6)
    assert result.clusters, "a 0.40 m movement over a 3 m radius must produce a finding"

    finding = result.clusters[0]
    assert finding.direction == "loss"
    assert np.allclose(finding.centroid[:2], [10.0, 10.0], atol=1.5)
    # 0.40 m vertical on a 0.5-gradient slope projects to 0.358 m along the
    # surface normal.
    assert np.isclose(abs(finding.peak_distance_m), 0.40 / np.linalg.norm([-0.5, 0, 1]), atol=0.06)
    assert np.isclose(result.site_volume.loss_m3, 0.40 * np.pi * 9, rtol=0.3)


def test_survey_of_unchanged_ground_reports_no_findings(tmp_path):
    baseline_m = slope_surface(n=20000, extent_m=20.0, seed=111)
    repeat_m = slope_surface(n=20000, extent_m=20.0, seed=612)

    result = run_survey(
        write_capture(tmp_path / "baseline.ply", baseline_m),
        write_capture(tmp_path / "repeat.ply", repeat_m),
        load_control_points(control_points_json(tmp_path / "base_gcp.json", CONTROL_LAYOUT)),
        load_control_points(control_points_json(tmp_path / "repeat_gcp.json", CONTROL_LAYOUT)),
    )

    assert result.clusters == []
    assert result.site_volume.net_m3 == 0.0
    assert result.field.measured_fraction > 0.9


def test_report_states_its_own_precision_before_its_findings(tmp_path):
    baseline_m = slope_surface(n=20000, extent_m=20.0, seed=112)
    repeat_m = displace_disc(baseline_m, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=-0.40)
    report_path = write_survey_report(
        run_survey(
            write_capture(tmp_path / "baseline.ply", baseline_m),
            write_capture(tmp_path / "repeat.ply", repeat_m),
            load_control_points(control_points_json(tmp_path / "base_gcp.json", CONTROL_LAYOUT)),
            load_control_points(control_points_json(tmp_path / "repeat_gcp.json", CONTROL_LAYOUT)),
        ),
        tmp_path / "out" / "change-report.json",
        baseline_label="2026-03-14",
        repeat_label="2026-04-25",
    )

    report = json.loads(report_path.read_text())

    assert report["baseline"] == "2026-03-14" and report["repeat"] == "2026-04-25"
    # A reader must be able to judge whether to trust the findings before
    # reading them: method, control residuals and registration quality are
    # all top-level, not buried per finding.
    assert "M3C2" in report["method"]["changeDetection"]
    assert report["precision"]["registrationRmseM"] >= 0
    assert report["precision"]["registrationConverged"] is True
    assert report["change"]["confidenceLevel"] == 0.95
    assert report["change"]["medianLevelOfDetectionM"] > 0
    assert report["findings"][0]["direction"] == "loss"
    assert report["findings"][0]["peakConfidenceRatio"] > 1.0


def test_run_monitor_writes_the_report_artifact(tmp_path):
    baseline_m = slope_surface(n=20000, extent_m=20.0, seed=113)
    repeat_m = displace_disc(baseline_m, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=-0.40)
    workdir = tmp_path / "work"

    report_path = run_monitor(
        workdir,
        write_capture(tmp_path / "baseline.ply", baseline_m),
        write_capture(tmp_path / "repeat.ply", repeat_m),
        control_points_json(tmp_path / "base_gcp.json", CONTROL_LAYOUT),
        control_points_json(tmp_path / "repeat_gcp.json", CONTROL_LAYOUT),
    )

    assert report_path == workdir / "survey" / "change-report.json"
    assert json.loads(report_path.read_text())["version"] == 1


def test_run_monitor_is_idempotent(tmp_path):
    # The stage has to be safely re-runnable after a crash the same way
    # every other stage is: same inputs, same document.
    baseline_m = slope_surface(n=12000, extent_m=20.0, seed=114)
    repeat_m = displace_disc(baseline_m, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=-0.40)
    workdir = tmp_path / "work"
    args = (
        write_capture(tmp_path / "baseline.ply", baseline_m),
        write_capture(tmp_path / "repeat.ply", repeat_m),
        control_points_json(tmp_path / "base_gcp.json", CONTROL_LAYOUT),
        control_points_json(tmp_path / "repeat_gcp.json", CONTROL_LAYOUT),
    )

    first = json.loads(run_monitor(workdir, *args).read_text())
    second = json.loads(run_monitor(workdir, *args).read_text())

    del first["generatedAt"], second["generatedAt"]
    assert first == second
