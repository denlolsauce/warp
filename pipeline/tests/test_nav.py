import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from colmap_fixtures import build_synthetic_reconstruction
from portal_pipeline.capture_manifest import CaptureEntry
from portal_pipeline.compress import CompressEntry
from portal_pipeline.errors import PipelineError
from portal_pipeline.nav import (
    assemble_manifest,
    build_nav_graph,
    build_nav_path,
    build_thresholds,
    compute_floor_y,
    compute_spawn,
    extract_camera_centres_by_folder,
    fit_catmull_rom,
    moving_average,
    resample_by_arc_length,
    run_nav,
    validate_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
HAS_NODE = shutil.which("node") is not None
VALIDATOR_EXISTS = (REPO_ROOT / "packages" / "schema" / "scripts" / "validate.mjs").is_file()
CAN_VALIDATE = HAS_NODE and VALIDATOR_EXISTS


def test_moving_average_preserves_constant_signal():
    points = np.tile(np.array([1.0, 2.0, 3.0]), (10, 1))
    smoothed = moving_average(points, window=5)
    assert np.allclose(smoothed, points)


def test_moving_average_short_input_returned_unchanged():
    points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
    smoothed = moving_average(points, window=5)
    assert np.allclose(smoothed, points)


def test_fit_catmull_rom_interpolates_endpoints():
    points = np.array([[0.0, 0.0, 0.0], [1.0, 2.0, 0.0], [3.0, 0.0, 0.0], [5.0, 1.0, 0.0]])
    dense = fit_catmull_rom(points, samples_per_segment=10)
    assert np.allclose(dense[0], points[0])
    assert np.allclose(dense[-1], points[-1])


def test_fit_catmull_rom_short_input_returned_unchanged():
    points = np.array([[0.0, 0.0, 0.0]])
    assert np.allclose(fit_catmull_rom(points), points)


def test_resample_by_arc_length_straight_line():
    dense = np.array([[float(x), 0.0, 0.0] for x in np.linspace(0, 10, 500)])
    resampled = resample_by_arc_length(dense, spacing=0.25)

    assert np.allclose(resampled[0], [0.0, 0.0, 0.0])
    assert np.allclose(resampled[-1], [10.0, 0.0, 0.0])

    step_lengths = np.linalg.norm(np.diff(resampled, axis=0), axis=1)
    assert np.allclose(step_lengths[:-1], 0.25, atol=1e-2)


def test_build_nav_path_end_to_end_straight_line():
    centres = np.array([[float(x), 0.0, 0.0] for x in range(20)])
    path = build_nav_path(centres)
    # moving-average edge-padding pulls the very first/last smoothed sample slightly
    # toward the boundary value, so allow a small tolerance rather than exact match.
    assert np.allclose(path[0], [0.0, 0.0, 0.0], atol=1.0)
    assert np.allclose(path[-1], [19.0, 0.0, 0.0], atol=1.0)
    assert np.all(np.diff(path[:, 0]) > 0)


def test_extract_camera_centres_by_folder_orders_by_capture(tmp_path: Path):
    images = [
        (1, "00_a/00002.jpg", (1.0, 0.0, 0.0)),
        (2, "00_a/00001.jpg", (0.0, 0.0, 0.0)),
        (3, "01_b/00001.jpg", (5.0, 0.0, 0.0)),
    ]
    reconstruction = build_synthetic_reconstruction(images)
    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    by_folder = extract_camera_centres_by_folder(sparse_path, needs_flip=False)

    assert set(by_folder.keys()) == {"00_a", "01_b"}
    # 00001.jpg must come before 00002.jpg regardless of image_id insertion order
    assert np.allclose(by_folder["00_a"][0], [0.0, 0.0, 0.0])
    assert np.allclose(by_folder["00_a"][1], [1.0, 0.0, 0.0])


def test_build_nav_graph_temporal_and_proximity_edges():
    paths = {
        "00_a": np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]]),
        "01_b": np.array([[2.05, 0.0, 0.0], [10.0, 0.0, 0.0]]),
    }
    nodes, edges, crossings = build_nav_graph(paths, proximity_threshold=0.8)

    assert len(nodes) == 5
    temporal_edges = {(0, 1), (1, 2), (3, 4)}
    assert temporal_edges.issubset({tuple(e) for e in edges})

    # node 2 (00_a's last, at x=2.0) and node 3 (01_b's first, at x=2.05) are 0.05m apart
    assert len(crossings) == 1
    assert crossings[0]["folder_a"] == "00_a"
    assert crossings[0]["folder_b"] == "01_b"
    assert (2, 3) in {tuple(e) for e in edges}


def test_build_nav_graph_no_proximity_when_far_apart():
    paths = {
        "00_a": np.array([[0.0, 0.0, 0.0]]),
        "01_b": np.array([[100.0, 0.0, 0.0]]),
    }
    _, edges, crossings = build_nav_graph(paths, proximity_threshold=0.8)
    assert crossings == []
    assert edges == []


def test_build_thresholds_symmetric_and_centroid():
    crossings = [
        {"folder_a": "00_a", "folder_b": "01_b", "pos": [0.0, 0.0, 0.0]},
        {"folder_a": "00_a", "folder_b": "01_b", "pos": [2.0, 0.0, 0.0]},
    ]
    thresholds = build_thresholds(crossings, radius=0.8)

    assert set(thresholds.keys()) == {"00_a", "01_b"}
    a_side = thresholds["00_a"][0]
    b_side = thresholds["01_b"][0]
    assert a_side["connects"] == "01_b"
    assert b_side["connects"] == "00_a"
    assert a_side["pos"] == [1.0, 0.0, 0.0]
    assert a_side["radius"] == 0.8


def test_compute_floor_y():
    nodes = [[0.0, 2.0, 0.0], [0.0, 2.0, 0.0], [0.0, 2.0, 0.0], [0.0, 100.0, 0.0]]
    # median height is 2.0 (100.0 outlier doesn't pull the median)
    assert compute_floor_y(nodes, offset=1.55) == pytest.approx(2.0 - 1.55)


def test_compute_spawn_yaw_convention():
    path_facing_x = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
    spawn = compute_spawn(path_facing_x)
    assert spawn["pos"] == [0.0, 0.0, 0.0]
    assert spawn["yaw"] == pytest.approx(90.0)

    path_facing_z = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    assert compute_spawn(path_facing_z)["yaw"] == pytest.approx(0.0)


def test_compute_spawn_single_node_defaults_yaw_zero():
    path = np.array([[1.0, 2.0, 3.0]])
    spawn = compute_spawn(path)
    assert spawn == {"pos": [1.0, 2.0, 3.0], "yaw": 0.0}


def test_assemble_manifest_overview_and_areas_split():
    capture_manifest = {
        "00_livingroom": CaptureEntry(role="overview", area_name="livingroom"),
        "01_kitchen": CaptureEntry(role="area", area_name="kitchen"),
    }
    compress_manifest = {
        "00_livingroom": CompressEntry(bbox=[[0, 0, 0], [1, 1, 1]], sog_path="overview.sog", sog_bytes=1000),
        "01_kitchen": CompressEntry(bbox=[[0, 0, 0], [1, 1, 1]], sog_path="kitchen.sog", sog_bytes=1000),
    }
    paths = {
        "00_livingroom": np.array([[0.0, 1.7, 0.0], [1.0, 1.7, 0.0]]),
        "01_kitchen": np.array([[5.0, 1.7, 0.0], [6.0, 1.7, 0.0]]),
    }
    nodes = [*paths["00_livingroom"].tolist(), *paths["01_kitchen"].tolist()]
    edges = [[0, 1], [2, 3]]

    manifest = assemble_manifest(
        "tour-1", capture_manifest, compress_manifest, paths, nodes, edges, {}
    )

    assert manifest["tourId"] == "tour-1"
    assert manifest["version"] == 1
    assert manifest["overview"] == {"common": "overview.sog", "chunks": {}}
    assert [a["id"] for a in manifest["areas"]] == ["01_kitchen"]
    assert manifest["areas"][0]["name"] == "kitchen"
    assert manifest["nav"]["nodes"] == nodes
    assert manifest["nav"]["edges"] == edges


def test_assemble_manifest_no_overview_role_is_null():
    capture_manifest = {"00_kitchen": CaptureEntry(role="area", area_name="kitchen")}
    compress_manifest = {
        "00_kitchen": CompressEntry(bbox=[[0, 0, 0], [1, 1, 1]], sog_path="kitchen.sog", sog_bytes=1000)
    }
    paths = {"00_kitchen": np.array([[0.0, 1.7, 0.0], [1.0, 1.7, 0.0]])}
    nodes = paths["00_kitchen"].tolist()
    edges = [[0, 1]]

    manifest = assemble_manifest(
        "tour-1", capture_manifest, compress_manifest, paths, nodes, edges, {}
    )
    assert manifest["overview"] is None
    assert len(manifest["areas"]) == 1


@pytest.mark.skipif(not CAN_VALIDATE, reason="node or packages/schema/scripts/validate.mjs not available")
def test_validate_manifest_accepts_valid_manifest():
    manifest = {
        "tourId": "t1",
        "version": 1,
        "upAxis": [0.0, 1.0, 0.0],
        "floorY": -1.5,
        "overview": None,
        "areas": [],
        "nav": {"nodes": [], "edges": []},
    }
    validate_manifest(manifest, REPO_ROOT)


@pytest.mark.skipif(not CAN_VALIDATE, reason="node or packages/schema/scripts/validate.mjs not available")
def test_validate_manifest_rejects_invalid_manifest():
    with pytest.raises(PipelineError) as excinfo:
        validate_manifest({"version": 1}, REPO_ROOT)
    assert excinfo.value.stage == "nav:validate"


@pytest.mark.skipif(not CAN_VALIDATE, reason="node or packages/schema/scripts/validate.mjs not available")
def test_run_nav_end_to_end(tmp_path: Path):
    # Slight Y/Z jitter (not exactly constant) keeps Y the clear lowest-
    # variance axis for detect_up_axis_flip without relying on exact-zero
    # ties; the floor/ceiling points below put the dense mass at low Y with
    # a sparse high-Y tail, so this fixture needs no flip.
    images = [
        (1, "00_overview/00001.jpg", (0.0, 1.70, 0.0)),
        (2, "00_overview/00002.jpg", (1.0, 1.69, 0.05)),
        (3, "00_overview/00003.jpg", (2.0, 1.71, -0.05)),
        (4, "01_kitchen/00001.jpg", (2.05, 1.70, 0.03)),
        (5, "01_kitchen/00002.jpg", (3.0, 1.69, -0.02)),
    ]
    floor_points = [(x, -1.0, z) for x in (0.0, 1.0, 2.0, 3.0) for z in (-0.5, 0.5)]
    ceiling_points = [(1.5, 4.0, 0.0)]
    reconstruction = build_synthetic_reconstruction(images, points=floor_points + ceiling_points)
    sparse_path = tmp_path / "sparse" / "0"
    sparse_path.mkdir(parents=True)
    reconstruction.write(str(sparse_path))

    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    (frames_dir / "capture_manifest.json").write_text(
        json.dumps(
            {
                "00_overview": {"role": "overview", "area_name": "livingroom"},
                "01_kitchen": {"role": "area", "area_name": "kitchen"},
            }
        )
    )

    compressed_dir = tmp_path / "compressed"
    compressed_dir.mkdir()
    (compressed_dir / "compress_manifest.json").write_text(
        json.dumps(
            {
                "00_overview": {"bbox": [[0, 0, 0], [2, 2, 2]], "sog_path": "overview.sog", "sog_bytes": 4_000_000},
                "01_kitchen": {"bbox": [[2, 0, 0], [4, 2, 2]], "sog_path": "kitchen.sog", "sog_bytes": 4_000_000},
            }
        )
    )

    run_nav(tmp_path, "tour-xyz", REPO_ROOT)

    manifest_path = tmp_path / "manifest.json"
    assert manifest_path.is_file()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["tourId"] == "tour-xyz"
    assert manifest["overview"]["common"] == "overview.sog"
    assert [a["id"] for a in manifest["areas"]] == ["01_kitchen"]
    # the two paths pass within 0.8m of each other -> at least one doorway threshold
    assert manifest["areas"][0]["thresholds"]
    assert manifest["areas"][0]["thresholds"][0]["connects"] == "00_overview"
