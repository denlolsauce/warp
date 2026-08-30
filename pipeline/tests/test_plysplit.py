from pathlib import Path

import numpy as np
from plyfile import PlyData

from ply_fixtures import write_gaussian_ply_at_positions
from splat_pipeline.plysplit import (
    inside_box_mask,
    load_ply_opacity,
    load_ply_positions,
    load_ply_scale,
    write_ply_subset,
)


def test_inside_box_mask_selects_only_points_within_bounds():
    positions = np.array([[0, 0, 0], [5, 5, 5], [-5, 0, 0], [2, 2, 2]], dtype=np.float64)
    bbox = (np.array([-1.0, -1.0, -1.0]), np.array([3.0, 3.0, 3.0]))
    mask = inside_box_mask(positions, bbox)
    assert mask.tolist() == [True, False, False, True]


def test_inside_box_mask_is_inclusive_of_boundary():
    positions = np.array([[1.0, 1.0, 1.0]], dtype=np.float64)
    bbox = (np.array([0.0, 0.0, 0.0]), np.array([1.0, 1.0, 1.0]))
    assert inside_box_mask(positions, bbox).tolist() == [True]


def test_write_ply_subset_shifts_opacity_when_asked(tmp_path: Path):
    ply_path = tmp_path / "in.ply"
    positions = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0)]
    write_gaussian_ply_at_positions(ply_path, positions, opacity_logit=-2.7)

    ply, _ = load_ply_positions(ply_path)
    out = tmp_path / "out.ply"
    write_ply_subset(ply, np.array([True, True, True]), out, opacity_logit_delta=2.0)

    _, _ = load_ply_positions(out)
    boosted = load_ply_opacity(PlyData.read(str(out)))
    # sigmoid(-2.7 + 2.0) = sigmoid(-0.7) ~= 0.3318
    assert np.allclose(boosted, 0.3318, atol=1e-3)


def test_write_ply_subset_leaves_opacity_alone_by_default(tmp_path: Path):
    ply_path = tmp_path / "in.ply"
    write_gaussian_ply_at_positions(ply_path, [(0.0, 0.0, 0.0)], opacity_logit=-2.7)

    ply, _ = load_ply_positions(ply_path)
    out = tmp_path / "out.ply"
    write_ply_subset(ply, np.array([True]), out)

    assert np.allclose(load_ply_opacity(PlyData.read(str(out))), 1 / (1 + np.exp(2.7)), atol=1e-4)


def test_load_ply_positions_matches_written_positions(tmp_path: Path):
    ply_path = tmp_path / "gaussians.ply"
    positions = [(0.0, 0.0, 0.0), (10.0, -2.5, 3.0), (-1.0, -1.0, -1.0)]
    write_gaussian_ply_at_positions(ply_path, positions)

    _, loaded = load_ply_positions(ply_path)
    assert np.allclose(loaded, positions)


def test_write_ply_subset_preserves_every_other_property(tmp_path: Path):
    ply_path = tmp_path / "gaussians.ply"
    positions = [(0.0, 0.0, 0.0), (10.0, 10.0, 10.0), (0.5, 0.5, 0.5)]
    write_gaussian_ply_at_positions(ply_path, positions)

    ply, _ = load_ply_positions(ply_path)
    mask = np.array([True, False, True])
    out_path = tmp_path / "subset.ply"
    count = write_ply_subset(ply, mask, out_path)
    assert count == 2

    subset = PlyData.read(str(out_path))["vertex"]
    assert subset.count == 2
    assert subset.data.dtype.names == ply["vertex"].data.dtype.names
    # Every property (not just x/y/z) for the kept rows survives untouched —
    # this only ever selects rows, never transforms Gaussian data.
    assert np.array_equal(subset.data, ply["vertex"].data[mask])


def test_load_ply_opacity_pinned_logits_decode_to_expected_sigmoid(tmp_path: Path):
    ply_path = tmp_path / "gaussians.ply"
    positions = [(0.0, 0.0, 0.0), (1.0, 1.0, 1.0), (2.0, 2.0, 2.0)]
    # logit 0 -> sigmoid 0.5 exactly; large +/- logits saturate near 1/0.
    write_gaussian_ply_at_positions(ply_path, positions, opacity_logit=[0.0, 10.0, -10.0])

    ply, _ = load_ply_positions(ply_path)
    opacity = load_ply_opacity(ply)

    assert np.isclose(opacity[0], 0.5)
    assert opacity[1] > 0.99
    assert opacity[2] < 0.01


def test_load_ply_scale_matches_exp_of_the_raw_stored_values(tmp_path: Path):
    ply_path = tmp_path / "gaussians.ply"
    positions = [(0.0, 0.0, 0.0), (1.0, 1.0, 1.0)]
    write_gaussian_ply_at_positions(ply_path, positions)

    ply, _ = load_ply_positions(ply_path)
    scale = load_ply_scale(ply)

    vertex = ply["vertex"]
    expected = np.exp(np.stack([vertex["scale_0"], vertex["scale_1"], vertex["scale_2"]], axis=1))
    assert scale.shape == (2, 3)
    assert np.allclose(scale, expected)
