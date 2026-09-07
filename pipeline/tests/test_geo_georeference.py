import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from splat_pipeline.errors import PipelineError
from splat_pipeline.geo.georeference import GroundControlPoint, fit_similarity_transform


def make_control_points(
    local: np.ndarray, scale: float, rotation: np.ndarray, translation: np.ndarray, noise_m: float = 0.0, seed: int = 0
) -> list[GroundControlPoint]:
    world = scale * (local @ rotation.T) + translation
    if noise_m:
        world = world + np.random.default_rng(seed).normal(0, noise_m, world.shape)
    return [
        GroundControlPoint(local=tuple(local_point), world=tuple(world_point))
        for local_point, world_point in zip(local, world)
    ]


def test_recovers_an_exact_similarity_transform():
    local = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.2], [0.0, 1.0, -0.1], [0.7, 0.6, 0.5]])
    rotation = Rotation.from_euler("xyz", [12.0, -30.0, 75.0], degrees=True).as_matrix()
    translation = np.array([412_300.0, 5_918_400.0, 61.2])  # realistic projected-CRS magnitudes

    transform = fit_similarity_transform(make_control_points(local, 42.5, rotation, translation))

    assert transform.rmse_m < 1e-6
    assert np.isclose(transform.scale, 42.5)
    assert np.allclose(transform.rotation, rotation, atol=1e-8)
    assert np.allclose(transform.translation, translation, atol=1e-6)


def test_apply_maps_local_points_into_world_metres():
    local = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    rotation = Rotation.from_euler("z", 33.0, degrees=True).as_matrix()
    translation = np.array([100.0, 200.0, 5.0])
    transform = fit_similarity_transform(make_control_points(local, 7.0, rotation, translation))

    # A local unit length must come out as exactly `scale` metres — this is
    # the entire point of georeferencing and the property everything
    # downstream assumes.
    mapped = transform.apply(np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]]))
    assert np.isclose(np.linalg.norm(mapped[1] - mapped[0]), 7.0)


def test_rmse_reports_control_point_disagreement():
    local = np.random.default_rng(4).uniform(-1, 1, size=(8, 3))
    rotation = Rotation.from_euler("y", 20.0, degrees=True).as_matrix()

    transform = fit_similarity_transform(
        make_control_points(local, 10.0, rotation, np.zeros(3), noise_m=0.05, seed=5)
    )

    # Per-axis noise of 0.05 m gives a 3D residual around 0.05*sqrt(3) before
    # the fit absorbs 7 DoF of it; the reported RMSE has to land in that
    # neighbourhood rather than being suspiciously near zero.
    assert 0.01 < transform.rmse_m < 0.15
    assert len(transform.per_point_residuals_m) == 8


def test_rejects_a_reflection_rather_than_mirroring_the_site():
    # A mirrored fit has identical residuals but inverted surface normals,
    # which would flip the sign of every M3C2 distance downstream — loss
    # reported as gain.
    local = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [0.5, 0.5, 0.5]])
    mirrored = local * np.array([1.0, 1.0, -1.0])
    control = [
        GroundControlPoint(local=tuple(a), world=tuple(b)) for a, b in zip(local, mirrored)
    ]

    transform = fit_similarity_transform(control)

    assert np.isclose(np.linalg.det(transform.rotation), 1.0)


def test_rejects_collinear_control_points():
    collinear = [
        GroundControlPoint(local=(0.0, 0.0, 0.0), world=(0.0, 0.0, 0.0)),
        GroundControlPoint(local=(1.0, 0.0, 0.0), world=(2.0, 0.0, 0.0)),
        GroundControlPoint(local=(2.0, 0.0, 0.0), world=(4.0, 0.0, 0.0)),
        GroundControlPoint(local=(3.0, 0.0, 0.0), world=(6.0, 0.0, 0.0)),
    ]

    with pytest.raises(PipelineError) as excinfo:
        fit_similarity_transform(collinear)
    assert excinfo.value.stage == "geo:georeference"
    assert "collinear" in str(excinfo.value)


def test_rejects_fewer_than_three_control_points():
    with pytest.raises(PipelineError) as excinfo:
        fit_similarity_transform(
            [
                GroundControlPoint(local=(0.0, 0.0, 0.0), world=(0.0, 0.0, 0.0)),
                GroundControlPoint(local=(1.0, 0.0, 0.0), world=(1.0, 0.0, 0.0)),
            ]
        )
    assert "at least 3 ground control points" in str(excinfo.value)
