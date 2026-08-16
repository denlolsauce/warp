import logging
import shutil
from pathlib import Path

import numpy as np
import pytest
from plyfile import PlyData

from colmap_fixtures import build_synthetic_reconstruction
from ply_fixtures import write_gaussian_ply_at_positions, write_synthetic_gaussian_ply
from portal_pipeline.compress import (
    MAX_SOG_BYTES,
    MIN_SOG_BYTES,
    bbox_from_submodel,
    check_sog_size,
    chunk_overview,
    compute_padded_bbox,
    convert_to_sog,
    detect_up_axis_flip,
    find_trained_ply,
    resolve_splat_transform_invocation,
)
from portal_pipeline.errors import PipelineError

HAS_SPLAT_TRANSFORM = shutil.which("splat-transform") is not None


def test_compute_padded_bbox():
    points = np.array([[0.0, 0.0, 0.0], [2.0, 4.0, -1.0]])
    bbox = compute_padded_bbox(points, pad=0.5)
    assert bbox == [[-0.5, -0.5, -1.5], [2.5, 4.5, 0.5]]


def test_find_trained_ply_none_raises(tmp_path: Path):
    with pytest.raises(PipelineError):
        find_trained_ply(tmp_path)


def test_find_trained_ply_single_match(tmp_path: Path):
    ply = tmp_path / "point_cloud" / "iteration_15000" / "point_cloud.ply"
    ply.parent.mkdir(parents=True)
    ply.write_bytes(b"")
    assert find_trained_ply(tmp_path) == ply


def test_find_trained_ply_picks_newest_and_warns(tmp_path: Path, caplog):
    old = tmp_path / "old.ply"
    new = tmp_path / "new.ply"
    old.write_bytes(b"")
    new.write_bytes(b"")
    import os
    import time

    os.utime(old, (time.time() - 100, time.time() - 100))

    with caplog.at_level(logging.WARNING):
        result = find_trained_ply(tmp_path)
    assert result == new
    assert "multiple .ply files found" in caplog.text


def test_check_sog_size_warns_outside_range(tmp_path: Path, caplog):
    too_small = tmp_path / "small.sog"
    too_small.write_bytes(b"0" * (MIN_SOG_BYTES - 1))
    with caplog.at_level(logging.WARNING):
        check_sog_size("00_a", too_small)
    assert "outside the expected 3-12 MB range" in caplog.text


def test_check_sog_size_no_warning_inside_range(tmp_path: Path, caplog):
    ok = tmp_path / "ok.sog"
    ok.write_bytes(b"0" * (MIN_SOG_BYTES + 1024))
    with caplog.at_level(logging.WARNING):
        check_sog_size("00_a", ok)
    assert caplog.text == ""


def test_check_sog_size_returns_byte_count(tmp_path: Path):
    size = MIN_SOG_BYTES + 500
    path = tmp_path / "f.sog"
    path.write_bytes(b"0" * size)
    assert check_sog_size("00_a", path) == size


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_resolve_splat_transform_invocation_against_real_cli():
    flags = resolve_splat_transform_invocation()
    assert flags == ["-w"]


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_convert_to_sog_real_conversion(tmp_path: Path):
    ply_path = tmp_path / "gaussians.ply"
    write_synthetic_gaussian_ply(ply_path, n=200)
    sog_path = tmp_path / "out" / "area.sog"

    convert_to_sog(ply_path, sog_path, ["-w"], needs_flip=True)

    assert sog_path.is_file()
    assert sog_path.stat().st_size > 0


def test_bbox_from_submodel_flip_negates_y_and_z(tmp_path: Path):
    images = [
        (1, "00_a/00001.jpg", (0.0, 0.0, 0.0)),
        (2, "00_a/00002.jpg", (2.0, 0.0, 0.0)),
    ]
    points = [(1.0, 5.0, -3.0)]
    reconstruction = build_synthetic_reconstruction(images, points=points)

    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    bbox = bbox_from_submodel(sparse_path, needs_flip=True, pad=0.0)
    mins, maxs = bbox
    # A point at (1, 5, -3) lands at (1, -5, 3) once Y/Z are negated.
    assert mins == [0.0, -5.0, 0.0]
    assert maxs == [2.0, 0.0, 3.0]


def test_bbox_from_submodel_no_flip_leaves_points_unchanged(tmp_path: Path):
    images = [
        (1, "00_a/00001.jpg", (0.0, 0.0, 0.0)),
        (2, "00_a/00002.jpg", (2.0, 0.0, 0.0)),
    ]
    points = [(1.0, 5.0, -3.0)]
    reconstruction = build_synthetic_reconstruction(images, points=points)

    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    bbox = bbox_from_submodel(sparse_path, needs_flip=False, pad=0.0)
    mins, maxs = bbox
    assert mins == [0.0, 0.0, -3.0]
    assert maxs == [2.0, 5.0, 0.0]


def test_detect_up_axis_flip_true_when_floor_mass_at_high_y(tmp_path: Path):
    # Cameras vary widely in X/Z but stay within a narrow Y band (chest
    # height) — Y is the low-variance axis. Most points cluster at high Y
    # (a "floor" sitting at the top of the raw reconstruction), pulling the
    # median above the mean, so +Y currently points down and needs flipping.
    images = [
        (1, "00_a/00001.jpg", (0.0, 1.50, 0.0)),
        (2, "00_a/00002.jpg", (4.0, 1.52, 0.0)),
        (3, "00_a/00003.jpg", (0.0, 1.48, 5.0)),
        (4, "00_a/00004.jpg", (4.0, 1.51, 5.0)),
    ]
    # 4 images cap point observations at 4 each (colmap_fixtures), so this
    # stays at 6 floor + 1 ceiling rather than a denser grid.
    floor_points = [(0.0, 3.0, 0.0), (1.0, 3.0, 0.0), (2.0, 3.0, 0.0), (0.0, 3.0, 5.0), (1.0, 3.0, 5.0), (2.0, 3.0, 5.0)]
    ceiling_points = [(1.0, -3.0, 2.5)]
    reconstruction = build_synthetic_reconstruction(images, points=floor_points + ceiling_points)

    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    assert detect_up_axis_flip(sparse_path) is True


def test_detect_up_axis_flip_false_when_floor_mass_at_low_y(tmp_path: Path):
    # Same shape, mirrored: dense "floor" mass sits at low Y, so +Y already
    # points up and no flip is needed.
    images = [
        (1, "00_a/00001.jpg", (0.0, 1.50, 0.0)),
        (2, "00_a/00002.jpg", (4.0, 1.52, 0.0)),
        (3, "00_a/00003.jpg", (0.0, 1.48, 5.0)),
        (4, "00_a/00004.jpg", (4.0, 1.51, 5.0)),
    ]
    floor_points = [(0.0, -3.0, 0.0), (1.0, -3.0, 0.0), (2.0, -3.0, 0.0), (0.0, -3.0, 5.0), (1.0, -3.0, 5.0), (2.0, -3.0, 5.0)]
    ceiling_points = [(1.0, 3.0, 2.5)]
    reconstruction = build_synthetic_reconstruction(images, points=floor_points + ceiling_points)

    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    assert detect_up_axis_flip(sparse_path) is False


def test_detect_up_axis_flip_raises_when_vertical_axis_is_not_y(tmp_path: Path):
    # Cameras vary widely in Y/Z but stay within a narrow X band here, so X
    # (not Y) is the low-variance axis — a case this pipeline hasn't
    # verified a rotation for.
    images = [
        (1, "00_a/00001.jpg", (1.50, 0.0, 0.0)),
        (2, "00_a/00002.jpg", (1.52, 4.0, 0.0)),
        (3, "00_a/00003.jpg", (1.48, 0.0, 5.0)),
        (4, "00_a/00004.jpg", (1.51, 4.0, 5.0)),
    ]
    points = [(3.0, 0.0, 0.0), (3.0, 1.0, 0.0), (3.0, 2.0, 0.0), (3.0, 0.0, 5.0), (3.0, 1.0, 5.0), (3.0, 2.0, 5.0)]
    reconstruction = build_synthetic_reconstruction(images, points=points)

    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    with pytest.raises(PipelineError):
        detect_up_axis_flip(sparse_path)


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_chunk_overview_partitions_points_with_no_overlap(tmp_path: Path):
    # Two well-separated "rooms" plus a hallway point that belongs to
    # neither — every point should land in exactly one output.
    area_a_points = [(0.0, 0.0, 0.0), (0.5, 0.5, 0.5), (-0.5, 0.0, 0.0)]
    area_b_points = [(10.0, 0.0, 0.0), (10.5, 0.0, 0.5)]
    hallway_points = [(5.0, 0.0, 0.0), (5.0, 0.0, 1.0)]
    all_points = area_a_points + area_b_points + hallway_points

    overview_ply = tmp_path / "overview.ply"
    write_gaussian_ply_at_positions(overview_ply, all_points)

    area_raw_bboxes = {
        "01_area_a": (np.array([-2.0, -2.0, -2.0]), np.array([2.0, 2.0, 2.0])),
        "02_area_b": (np.array([8.0, -2.0, -2.0]), np.array([12.0, 2.0, 2.0])),
    }
    compressed_dir = tmp_path / "compressed"

    common_sog_path, common_size, chunk_paths = chunk_overview(
        overview_ply, area_raw_bboxes, compressed_dir, "00_overview", ["-w"], needs_flip=False
    )

    assert set(chunk_paths.keys()) == {"01_area_a", "02_area_b"}
    assert Path(chunk_paths["01_area_a"]).is_file()
    assert Path(chunk_paths["02_area_b"]).is_file()
    assert common_sog_path.is_file()
    assert common_size > 0

    # Point-level partition, checked via the intermediate PLYs chunk_overview
    # leaves on disk before SOG conversion.
    chunk_a = PlyData.read(str(compressed_dir / "overview_chunks" / "01_area_a.ply"))["vertex"]
    chunk_b = PlyData.read(str(compressed_dir / "overview_chunks" / "02_area_b.ply"))["vertex"]
    common = PlyData.read(str(compressed_dir / "00_overview_common.ply"))["vertex"]

    assert chunk_a.count == len(area_a_points)
    assert chunk_b.count == len(area_b_points)
    assert common.count == len(hallway_points)
    # No double-density ghosting: every input point appears in exactly one
    # output, so the counts sum back to the original total.
    assert chunk_a.count + chunk_b.count + common.count == len(all_points)


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_chunk_overview_skips_area_with_no_overview_coverage(tmp_path: Path, caplog):
    overview_ply = tmp_path / "overview.ply"
    # A hallway point outside every box, so common stays non-empty here —
    # this test is specifically about the empty-*area*-chunk skip path.
    write_gaussian_ply_at_positions(overview_ply, [(0.0, 0.0, 0.0), (50.0, 50.0, 50.0)])

    area_raw_bboxes = {
        "01_area_a": (np.array([-2.0, -2.0, -2.0]), np.array([2.0, 2.0, 2.0])),
        "02_empty_area": (np.array([100.0, 100.0, 100.0]), np.array([101.0, 101.0, 101.0])),
    }
    compressed_dir = tmp_path / "compressed"

    with caplog.at_level(logging.WARNING):
        _, _, chunk_paths = chunk_overview(
            overview_ply, area_raw_bboxes, compressed_dir, "00_overview", ["-w"], needs_flip=False
        )

    assert set(chunk_paths.keys()) == {"01_area_a"}
    assert "02_empty_area" in caplog.text


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_chunk_overview_raises_when_common_would_be_empty(tmp_path: Path):
    overview_ply = tmp_path / "overview.ply"
    write_gaussian_ply_at_positions(overview_ply, [(0.0, 0.0, 0.0)])

    # The single overview point falls entirely inside this one area's bbox,
    # leaving nothing for "common" — splat-transform can't encode a
    # zero-vertex PLY, and overview.common isn't optional, so this must
    # fail clearly rather than let that opaque error through.
    area_raw_bboxes = {
        "01_area_a": (np.array([-2.0, -2.0, -2.0]), np.array([2.0, 2.0, 2.0])),
    }
    compressed_dir = tmp_path / "compressed"

    with pytest.raises(PipelineError, match="common"):
        chunk_overview(overview_ply, area_raw_bboxes, compressed_dir, "00_overview", ["-w"], needs_flip=False)
