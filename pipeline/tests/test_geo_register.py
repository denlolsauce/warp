import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from geo_fixtures import displace_disc, slope_surface
from splat_pipeline.errors import PipelineError
from splat_pipeline.geo.cloud import median_point_spacing
from splat_pipeline.geo.register import align_captures


def test_recovers_a_known_rigid_offset():
    baseline = slope_surface(seed=1)
    spacing = median_point_spacing(baseline)
    rotation = Rotation.from_euler("xyz", [0.3, -0.2, 0.5], degrees=True).as_matrix()
    offset = np.array([0.08, -0.05, 0.03])
    misaligned = baseline @ rotation.T + offset

    alignment = align_captures(misaligned, baseline, spacing)

    assert alignment.converged
    # Recovering the *inverse* of the applied offset is what "aligned onto
    # the baseline" means; checking the composed transform is identity is
    # stricter than checking translation alone, which a compensating
    # rotation could fake.
    composed_rotation = alignment.rotation @ rotation
    assert np.allclose(composed_rotation, np.eye(3), atol=1e-3)
    assert np.allclose(alignment.apply(misaligned).mean(axis=0), baseline.mean(axis=0), atol=2e-3)


def test_rmse_reflects_the_quality_of_the_final_fit():
    baseline = slope_surface(seed=2, roughness_m=0.005)
    spacing = median_point_spacing(baseline)

    alignment = align_captures(baseline + np.array([0.05, 0.0, 0.0]), baseline, spacing)

    # A clean rigid offset on identical points must align to well under the
    # surface roughness — this is the number change.py builds its level of
    # detection from, so an inflated RMSE would silently blind the survey.
    assert alignment.rmse_m < 0.005


def test_a_changed_region_does_not_drag_the_alignment():
    # The reason for trimmed rather than plain ICP: a real slip must not be
    # partly absorbed into the transform, or its own signal is smeared
    # across the whole site.
    baseline = slope_surface(n=8000, seed=3)
    spacing = median_point_spacing(baseline)
    changed = displace_disc(baseline, centre_xy=(5.0, 5.0), radius_m=3.0, displacement_m=0.5)

    alignment = align_captures(changed, baseline, spacing)

    # The stable ~93% of the surface didn't move, so the fit should be
    # near-identity rather than splitting the difference with the disc.
    assert np.linalg.norm(alignment.translation) < 0.02
    assert np.allclose(alignment.rotation, np.eye(3), atol=1e-3)


def test_refuses_to_align_captures_of_different_ground():
    # A converged fit between unrelated clouds is worse than a failure: it
    # produces a confident report about ground that was never compared.
    baseline = slope_surface(seed=6)
    spacing = median_point_spacing(baseline)
    far_away = baseline + np.array([500.0, 500.0, 0.0])

    with pytest.raises(PipelineError) as excinfo:
        align_captures(far_away, baseline, spacing)
    assert excinfo.value.stage == "geo:register"
    assert "not of the same ground" in str(excinfo.value) or "overlapping surface" in str(excinfo.value)


def test_rejects_a_non_positive_point_spacing():
    baseline = slope_surface(n=100, seed=7)
    with pytest.raises(PipelineError) as excinfo:
        align_captures(baseline, baseline, 0.0)
    assert "point spacing must be positive" in str(excinfo.value)


def test_rejects_clouds_too_small_to_align():
    with pytest.raises(PipelineError) as excinfo:
        align_captures(np.zeros((2, 3)), np.zeros((5, 3)), 0.1)
    assert "at least 3 points" in str(excinfo.value)
