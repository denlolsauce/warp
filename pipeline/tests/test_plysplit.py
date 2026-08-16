from pathlib import Path

import numpy as np
from plyfile import PlyData

from ply_fixtures import write_gaussian_ply_at_positions
from portal_pipeline.plysplit import inside_box_mask, load_ply_positions, write_ply_subset


def test_inside_box_mask_selects_only_points_within_bounds():
    positions = np.array([[0, 0, 0], [5, 5, 5], [-5, 0, 0], [2, 2, 2]], dtype=np.float64)
    bbox = (np.array([-1.0, -1.0, -1.0]), np.array([3.0, 3.0, 3.0]))
    mask = inside_box_mask(positions, bbox)
    assert mask.tolist() == [True, False, False, True]


def test_inside_box_mask_is_inclusive_of_boundary():
    positions = np.array([[1.0, 1.0, 1.0]], dtype=np.float64)
    bbox = (np.array([0.0, 0.0, 0.0]), np.array([1.0, 1.0, 1.0]))
    assert inside_box_mask(positions, bbox).tolist() == [True]


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
