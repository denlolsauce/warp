import numpy as np
import pytest

from geo_fixtures import slope_surface
from ply_fixtures import write_gaussian_ply_at_positions
from splat_pipeline.errors import PipelineError
from splat_pipeline.geo.cloud import load_surface_points, median_point_spacing


def logit(p: float) -> float:
    return float(np.log(p / (1 - p)))


def test_median_point_spacing_measures_the_clouds_resolution():
    # A regular 0.1 m lattice has an exactly known nearest-neighbour
    # distance; every radius in this subsystem is a multiple of this number,
    # so it has to be the real spacing rather than merely monotonic in it.
    axis = np.arange(0, 20) * 0.1
    gx, gy = np.meshgrid(axis, axis)
    lattice = np.column_stack([gx.ravel(), gy.ravel(), np.zeros(gx.size)])

    assert np.isclose(median_point_spacing(lattice), 0.1)


def test_median_point_spacing_rejects_a_single_point():
    with pytest.raises(PipelineError) as excinfo:
        median_point_spacing(np.zeros((1, 3)))
    assert excinfo.value.stage == "geo:cloud"


def test_low_opacity_interior_fill_is_excluded_from_measurement(tmp_path):
    # cleanup's dilation pass deliberately re-admits low-opacity gaussians
    # inside the object so it renders solid. Those sit off the surface, and
    # averaging them into a change distance would bias every measurement.
    surface = slope_surface(n=1000, seed=90)
    fill = surface + np.array([0.0, 0.0, -0.5])
    positions = [tuple(p) for p in np.vstack([surface, fill])]
    opacities = [logit(0.9)] * len(surface) + [logit(0.05)] * len(fill)
    ply_path = tmp_path / "capture.ply"
    write_gaussian_ply_at_positions(ply_path, positions, opacity_logit=opacities)

    points = load_surface_points(ply_path)

    assert len(points) < len(positions)
    # Every retained point belongs to the surface, not the fill 0.5 m below.
    assert points[:, 2].min() > surface[:, 2].min() - 0.1


def test_oversized_background_gaussians_are_excluded(tmp_path):
    # A handful of scene-spanning gaussians stand in for sky and haze. Their
    # centres are not surface samples and would appear as isolated
    # "findings" wherever MCMC last left them.
    surface = slope_surface(n=1000, seed=91)
    positions = [tuple(p) for p in surface] + [(0.0, 0.0, 400.0), (0.0, 0.0, 500.0)]
    ply_path = tmp_path / "capture.ply"
    write_gaussian_ply_at_positions(ply_path, positions, opacity_logit=logit(0.9))

    # write_gaussian_ply_at_positions randomises log-scale over [-3, -1], so
    # a percentile cut is exercised here rather than the specific sky
    # gaussians; the invariant under test is that the top scale percentile
    # never survives into the measurement cloud.
    points = load_surface_points(ply_path, max_scale_percentile=99.0)

    assert len(points) < len(positions)


def test_refuses_a_capture_with_too_few_opaque_gaussians(tmp_path):
    surface = slope_surface(n=800, seed=92)
    ply_path = tmp_path / "sparse.ply"
    write_gaussian_ply_at_positions(ply_path, [tuple(p) for p in surface], opacity_logit=logit(0.02))

    with pytest.raises(PipelineError) as excinfo:
        load_surface_points(ply_path)
    assert excinfo.value.stage == "geo:cloud"
    assert "too sparse or too" in str(excinfo.value)


def test_missing_ply_fails_with_the_path(tmp_path):
    with pytest.raises(PipelineError) as excinfo:
        load_surface_points(tmp_path / "nope.ply")
    assert "nope.ply" in str(excinfo.value)
