import numpy as np
import pytest

from geo_fixtures import displace_disc, slope_surface
from splat_pipeline.errors import PipelineError
from splat_pipeline.geo.change import ChangeConfig, compute_change, estimate_normals
from splat_pipeline.geo.cloud import median_point_spacing
from splat_pipeline.geo.survey import subsample_core_points


def build_case(
    displacement_m: float = 0.0,
    registration_error_m: float = 0.0,
    roughness_m: float = 0.01,
    n: int = 12000,
    seed: int = 20,
):
    baseline = slope_surface(n=n, roughness_m=roughness_m, seed=seed)
    repeat = (
        displace_disc(baseline, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=displacement_m)
        if displacement_m
        else slope_surface(n=n, roughness_m=roughness_m, seed=seed + 500)
    )
    spacing = median_point_spacing(baseline)
    core = subsample_core_points(baseline, spacing * 3.0)
    config = ChangeConfig.from_point_spacing(spacing, registration_error_m)
    return baseline, repeat, core, config


# ---------------------------------------------------------------------------
# estimate_normals
# ---------------------------------------------------------------------------


def test_normals_follow_the_slope_not_the_vertical():
    # A 0.5-gradient plane's normal is (-0.5, 0, 1)/|.|, ~26.6 deg off
    # vertical. Getting this wrong means every distance is measured along
    # the wrong direction and understates real movement by cos(error).
    surface = slope_surface(n=4000, gradient=0.5, roughness_m=0.001, seed=21)
    spacing = median_point_spacing(surface)
    cores = surface[:50]

    normals, counts = estimate_normals(surface, cores, spacing * 20.0, np.array([0.0, 0.0, 1.0]))

    expected = np.array([-0.5, 0.0, 1.0]) / np.linalg.norm([-0.5, 0.0, 1.0])
    assert (counts >= 3).all()
    assert np.allclose(np.abs(normals @ expected), 1.0, atol=1e-2)


def test_normals_are_sign_consistent_with_the_up_hint():
    # PCA's normal sign is arbitrary per point; unresolved flips would
    # randomly negate individual distances, making erosion and deposition
    # indistinguishable point to point.
    surface = slope_surface(n=3000, seed=22)
    spacing = median_point_spacing(surface)

    normals, _ = estimate_normals(surface, surface[:200], spacing * 20.0, np.array([0.0, 0.0, 1.0]))

    assert (normals[:, 2] > 0).all()


def test_degenerate_neighbourhood_falls_back_to_the_up_hint_and_reports_it():
    surface = slope_surface(n=1000, seed=23)
    isolated = np.array([[500.0, 500.0, 500.0]])

    normals, counts = estimate_normals(surface, isolated, 0.5, np.array([0.0, 0.0, 1.0]))

    assert counts[0] == 0
    assert np.allclose(normals[0], [0.0, 0.0, 1.0])


# ---------------------------------------------------------------------------
# compute_change: recovering a known displacement
# ---------------------------------------------------------------------------


def test_recovers_a_known_displacement_magnitude():
    baseline, repeat, core, config = build_case(displacement_m=0.30)

    field = compute_change(baseline, repeat, core, config)

    inside_disc = np.linalg.norm(core[:, :2] - np.array([10.0, 10.0]), axis=1) < 2.0
    detected = field.significant & inside_disc
    assert detected.sum() > 20

    # The disc moved +0.30 m vertically; M3C2 measures along the surface
    # normal, so the projected distance is 0.30 * cos(26.6 deg) = 0.268.
    expected = 0.30 * (1.0 / np.linalg.norm([-0.5, 0.0, 1.0]))
    assert np.isclose(np.median(field.distance_m[detected]), expected, atol=0.02)


def test_distance_sign_distinguishes_loss_from_gain():
    _, _, _, _ = build_case()
    baseline, gained, core, config = build_case(displacement_m=0.30)
    _, lost, _, _ = build_case(displacement_m=-0.30)

    gain_field = compute_change(baseline, gained, core, config)
    loss_field = compute_change(baseline, lost, core, config)

    inside = np.linalg.norm(core[:, :2] - np.array([10.0, 10.0]), axis=1) < 2.0
    assert (gain_field.distance_m[gain_field.significant & inside] > 0).all()
    assert (loss_field.distance_m[loss_field.significant & inside] < 0).all()


def test_a_stable_surface_reports_almost_no_significant_change():
    # Two independent captures of unchanged ground. At LoD95% some points
    # register by chance (that is what 95% means); the guard is that it stays
    # near the expected few percent rather than lighting up the site.
    baseline, repeat, core, config = build_case(displacement_m=0.0)

    field = compute_change(baseline, repeat, core, config)

    assert field.measured_fraction > 0.9
    significant_rate = field.significant.sum() / field.measured.sum()
    assert significant_rate < 0.1


# ---------------------------------------------------------------------------
# Level of detection
# ---------------------------------------------------------------------------


def test_a_rougher_surface_raises_the_level_of_detection():
    _, _, _, _ = build_case()
    smooth_baseline, smooth_repeat, smooth_core, smooth_config = build_case(roughness_m=0.005, seed=30)
    rough_baseline, rough_repeat, rough_core, rough_config = build_case(roughness_m=0.05, seed=30)

    smooth = compute_change(smooth_baseline, smooth_repeat, smooth_core, smooth_config)
    rough = compute_change(rough_baseline, rough_repeat, rough_core, rough_config)

    smooth_lod = np.nanmedian(smooth.level_of_detection_m)
    rough_lod = np.nanmedian(rough.level_of_detection_m)
    assert rough_lod > smooth_lod * 3


def test_registration_error_widens_the_level_of_detection_and_suppresses_findings():
    # The property that makes a bad alignment safe: it must reduce
    # confidence, never manufacture it. A 0.25 m displacement that is
    # significant under a clean registration must stop being significant
    # once the registration error alone exceeds it.
    baseline, repeat, core, clean_config = build_case(displacement_m=0.25, registration_error_m=0.0)
    sloppy_config = ChangeConfig.from_point_spacing(
        clean_config.cylinder_radius_m / 6.0, registration_error_m=0.40
    )

    clean = compute_change(baseline, repeat, core, clean_config)
    sloppy = compute_change(baseline, repeat, core, sloppy_config)

    assert clean.significant.sum() > 20
    assert sloppy.significant.sum() == 0
    assert np.nanmedian(sloppy.level_of_detection_m) >= 0.40


def test_level_of_detection_never_falls_below_the_registration_error():
    baseline, repeat, core, config = build_case(displacement_m=0.30, registration_error_m=0.02)

    field = compute_change(baseline, repeat, core, config)

    assert np.nanmin(field.level_of_detection_m) >= 0.02


# ---------------------------------------------------------------------------
# Unmeasured vs. insignificant
# ---------------------------------------------------------------------------


def test_unmeasured_points_are_nan_and_flagged_not_reported_as_zero():
    # An area with no counterpart in the repeat capture is a reason to
    # re-fly. Reporting it as 0.00 m would present a hole in the survey as
    # a positive finding of stability.
    baseline, repeat, core, config = build_case()
    # Delete the repeat capture's coverage over one corner entirely.
    repeat = repeat[~((repeat[:, 0] < 5.0) & (repeat[:, 1] < 5.0))]

    field = compute_change(baseline, repeat, core, config)

    corner = (core[:, 0] < 3.0) & (core[:, 1] < 3.0)
    assert corner.sum() > 0
    assert not field.measured[corner].any()
    assert np.isnan(field.distance_m[corner]).all()
    assert not field.significant[corner].any()


def test_movement_beyond_the_cylinder_is_unmeasured_rather_than_clipped():
    # A clipped distance would understate exactly the largest movements —
    # the ones that matter most.
    baseline, repeat, core, config = build_case(displacement_m=0.0)
    huge = displace_disc(baseline, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=50.0)

    field = compute_change(baseline, huge, core, config)

    inside = np.linalg.norm(core[:, :2] - np.array([10.0, 10.0]), axis=1) < 2.0
    assert not field.measured[inside].any()
    assert not (np.abs(field.distance_m[field.measured]) > config.cylinder_half_length_m).any()


# ---------------------------------------------------------------------------
# Config and guards
# ---------------------------------------------------------------------------


def test_config_scales_every_radius_with_the_cloud_resolution():
    fine = ChangeConfig.from_point_spacing(0.01, 0.0)
    coarse = ChangeConfig.from_point_spacing(0.10, 0.0)

    assert np.isclose(coarse.normal_radius_m, fine.normal_radius_m * 10)
    assert coarse.cylinder_radius_m < coarse.normal_radius_m


def test_config_rejects_a_negative_registration_error():
    with pytest.raises(PipelineError) as excinfo:
        ChangeConfig.from_point_spacing(0.01, -0.1)
    assert "cannot be negative" in str(excinfo.value)


def test_summary_reports_coverage_and_extremes():
    baseline, repeat, core, config = build_case(displacement_m=0.30, registration_error_m=0.01)

    summary = compute_change(baseline, repeat, core, config).summary()

    assert summary["confidenceLevel"] == 0.95
    assert summary["registrationErrorM"] == 0.01
    assert 0.0 < summary["measuredFraction"] <= 1.0
    assert summary["maxGainM"] > 0.2
    assert summary["medianLevelOfDetectionM"] >= 0.01


def test_rejects_a_baseline_too_sparse_to_measure():
    with pytest.raises(PipelineError) as excinfo:
        compute_change(
            np.zeros((2, 3)), slope_surface(n=100), np.zeros((1, 3)), ChangeConfig.from_point_spacing(0.1, 0.0)
        )
    assert excinfo.value.stage == "geo:change"
