import numpy as np
import pytest

from geo_fixtures import displace_disc, slope_surface
from splat_pipeline.errors import PipelineError
from splat_pipeline.geo.change import ChangeConfig, ChangeField, compute_change
from splat_pipeline.geo.cloud import median_point_spacing
from splat_pipeline.geo.survey import subsample_core_points
from splat_pipeline.geo.volume import planar_grid_volume


def synthetic_field(
    distances: np.ndarray,
    points: np.ndarray,
    normals: np.ndarray,
    registration_error_m: float = 0.0,
    random_lod_m: float = 0.001,
) -> ChangeField:
    """A ChangeField assembled directly, so a volume can be checked against
    an exactly-known geometry rather than against whatever M3C2 happened to
    measure on a synthetic cloud."""
    n = len(points)
    config = ChangeConfig(
        normal_radius_m=1.0,
        cylinder_radius_m=0.5,
        cylinder_half_length_m=4.0,
        registration_error_m=registration_error_m,
    )
    return ChangeField(
        core_points=points,
        normal=normals,
        distance_m=distances,
        level_of_detection_m=np.full(n, random_lod_m + registration_error_m),
        roughness_baseline_m=np.full(n, random_lod_m),
        roughness_repeat_m=np.full(n, random_lod_m),
        count_baseline=np.full(n, 20),
        count_repeat=np.full(n, 20),
        measured=np.ones(n, dtype=bool),
        significant=np.abs(distances) > (random_lod_m + registration_error_m),
        config=config,
    )


def flat_grid(extent_m: float = 10.0, step_m: float = 0.25) -> np.ndarray:
    """A dense flat patch of exactly `extent_m` square.

    Offset by half a step so no sample sits exactly on an integer
    coordinate. Grid integration credits every occupied cell its full
    footprint, so points landing precisely on a cell boundary put a
    single-row sliver into an extra cell and inflate the area by one cell
    per row — real quantisation behaviour at a region's edge, but not what
    these tests are measuring.
    """
    axis = np.arange(0.0, extent_m, step_m) + step_m / 2
    gx, gy = np.meshgrid(axis, axis)
    return np.column_stack([gx.ravel(), gy.ravel(), np.zeros(gx.size)])


def test_recovers_a_known_volume_on_flat_ground():
    # 10x10 m of ground raised by exactly 0.20 m = 20 m3, computed from
    # geometry rather than from a previous run of this code.
    points = flat_grid()
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    field = synthetic_field(np.full(len(points), 0.20), points, normals)

    estimate = planar_grid_volume(field)

    assert np.isclose(estimate.net_m3, 20.0, rtol=0.05)
    assert np.isclose(estimate.gain_m3, 20.0, rtol=0.05)
    assert estimate.loss_m3 == 0.0
    assert np.isclose(estimate.surface_area_m2, 100.0, rtol=0.05)


def test_gain_and_loss_are_reported_separately_not_only_netted():
    # The failure this prevents: material off the crest and the same volume
    # piled at the toe nets to zero, which is a developing failure reported
    # as "no change".
    points = flat_grid()
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    distances = np.where(points[:, 0] < 5.0, -0.20, 0.20)
    field = synthetic_field(distances, points, normals)

    estimate = planar_grid_volume(field)

    assert abs(estimate.net_m3) < 0.5
    assert np.isclose(estimate.gain_m3, 10.0, rtol=0.05)
    assert np.isclose(estimate.loss_m3, 10.0, rtol=0.05)


def test_sloped_surface_area_is_corrected_not_taken_as_projected():
    # A 45-degree face has sqrt(2)x the surface area of its own footprint.
    # Skipping the correction understates every volume on a slope, which is
    # the only kind of ground this product measures.
    footprint = flat_grid()
    tilted = np.column_stack([footprint[:, 0], footprint[:, 1], footprint[:, 0]])
    normal = np.array([-1.0, 0.0, 1.0]) / np.sqrt(2)
    normals = np.tile(normal, (len(tilted), 1))
    field = synthetic_field(np.full(len(tilted), 0.10), tilted, normals)

    estimate = planar_grid_volume(field, plane_normal=np.array([0.0, 0.0, 1.0]))

    assert np.isclose(estimate.surface_area_m2, 100.0 * np.sqrt(2), rtol=0.05)
    assert np.isclose(estimate.net_m3, 10.0 * np.sqrt(2), rtol=0.05)


def test_near_vertical_faces_are_excluded_and_reported_not_silently_diverged():
    points = flat_grid()
    # Normals perpendicular to the projection plane: projected footprint
    # vanishes, so the area correction would divide by ~zero.
    normals = np.tile([1.0, 0.0, 0.0], (len(points), 1))
    field = synthetic_field(np.full(len(points), 0.20), points, normals)

    estimate = planar_grid_volume(field, plane_normal=np.array([0.0, 0.0, 1.0]))

    assert estimate.net_m3 == 0.0
    assert estimate.cell_count == 0
    assert estimate.excluded_steep_area_m2 > 0


def test_insignificant_change_contributes_nothing():
    # Summing sub-LoD readings over a large area accumulates noise into a
    # number that looks like a measurement.
    points = flat_grid()
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    field = synthetic_field(np.full(len(points), 0.0005), points, normals, random_lod_m=0.01)

    estimate = planar_grid_volume(field)

    assert not field.significant.any()
    assert estimate.net_m3 == 0.0
    assert estimate.uncertainty_m3 == 0.0


def test_registration_error_dominates_uncertainty_over_a_large_area():
    # The systematic term grows linearly with area while the random term
    # grows as its root, so on a big region a poor alignment must widen the
    # error band rather than average away.
    points = flat_grid()
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    distances = np.full(len(points), 0.5)

    clean = planar_grid_volume(synthetic_field(distances, points, normals, registration_error_m=0.0))
    sloppy = planar_grid_volume(synthetic_field(distances, points, normals, registration_error_m=0.05))

    assert sloppy.uncertainty_m3 > clean.uncertainty_m3 * 5
    # 0.05 m of systematic error over ~100 m2 is ~5 m3, and that term alone
    # sets the floor.
    assert sloppy.uncertainty_m3 > 4.0


def test_mask_restricts_the_volume_to_one_region():
    points = flat_grid()
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    field = synthetic_field(np.full(len(points), 0.20), points, normals)
    mask = points[:, 0] < 5.0

    estimate = planar_grid_volume(field, mask=mask)

    assert np.isclose(estimate.net_m3, 10.0, rtol=0.05)


def test_returns_zero_when_nothing_is_significant():
    points = flat_grid(extent_m=2.0)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    field = synthetic_field(np.zeros(len(points)), points, normals)

    estimate = planar_grid_volume(field)

    assert (estimate.net_m3, estimate.cell_count, estimate.uncertainty_m3) == (0.0, 0, 0.0)


def test_rejects_a_degenerate_projection_plane():
    points = flat_grid(extent_m=2.0)
    normals = np.tile([0.0, 0.0, 1.0], (len(points), 1))
    field = synthetic_field(np.full(len(points), 0.20), points, normals)

    with pytest.raises(PipelineError) as excinfo:
        planar_grid_volume(field, plane_normal=np.zeros(3))
    assert excinfo.value.stage == "geo:volume"


def test_end_to_end_volume_on_a_measured_displacement():
    # The same quantity through the real M3C2 path rather than a synthetic
    # field: a 3 m-radius disc of a 0.5-gradient slope lifted 0.30 m
    # vertically. Volume is displacement x footprint area regardless of
    # slope (the surface-area correction and the normal-projected distance
    # cancel), so the truth is 0.30 * pi * 9 = 8.48 m3.
    baseline = slope_surface(n=20000, seed=40)
    repeat = displace_disc(baseline, centre_xy=(10.0, 10.0), radius_m=3.0, displacement_m=0.30)
    spacing = median_point_spacing(baseline)
    core = subsample_core_points(baseline, spacing * 3.0)
    config = ChangeConfig.from_point_spacing(spacing, 0.0)

    field = compute_change(baseline, repeat, core, config)
    estimate = planar_grid_volume(field, plane_normal=np.array([0.0, 0.0, 1.0]))

    expected = 0.30 * np.pi * 3.0 ** 2
    # Loose tolerance on purpose: the disc's edge is one cylinder radius
    # wide in the change field, so its recovered footprint is fuzzy at the
    # boundary. This test is checking the volume is right to within the
    # method's own edge resolution, not to the millilitre.
    assert np.isclose(estimate.net_m3, expected, rtol=0.25)
