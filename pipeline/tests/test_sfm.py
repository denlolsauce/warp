from pathlib import Path

import pytest

from colmap_fixtures import build_synthetic_reconstruction
from portal_pipeline.capture_manifest import CaptureEntry, write_capture_manifest
from portal_pipeline.errors import PipelineError
from portal_pipeline.sfm import compute_registration_stats, verify_reconstruction


def test_compute_registration_stats_computes_per_folder_ratio():
    total_by_folder = {"00_kitchen": 10, "01_bath": 5}
    registered = [f"00_kitchen/{i:05d}.jpg" for i in range(8)] + ["01_bath/00001.jpg"]

    stats = compute_registration_stats(registered, total_by_folder)

    assert stats["00_kitchen"] == (8, 10, 0.8)
    assert stats["01_bath"] == (1, 5, 0.2)


def test_compute_registration_stats_ignores_unknown_folder():
    total_by_folder = {"00_kitchen": 4}
    registered = ["00_kitchen/00001.jpg", "not_a_tracked_folder/00001.jpg"]

    stats = compute_registration_stats(registered, total_by_folder)

    assert stats == {"00_kitchen": (1, 4, 0.25)}


def test_compute_registration_stats_zero_total_is_zero_ratio():
    stats = compute_registration_stats([], {"00_empty": 0})
    assert stats["00_empty"] == (0, 0, 0.0)


def test_verify_reconstruction_fails_on_zero_submodels(tmp_path: Path):
    sparse_dir = tmp_path / "sparse"
    sparse_dir.mkdir()
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()

    with pytest.raises(PipelineError) as excinfo:
        verify_reconstruction(sparse_dir, frames_dir)
    assert excinfo.value.stage == "sfm:verify"
    assert "sparse/0" in excinfo.value.message


def test_verify_reconstruction_fails_on_multiple_submodels(tmp_path: Path):
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    (sparse_dir / "1").mkdir(parents=True)
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()

    with pytest.raises(PipelineError) as excinfo:
        verify_reconstruction(sparse_dir, frames_dir)
    assert excinfo.value.stage == "sfm:verify"
    assert "fragmented" in excinfo.value.message


def test_verify_reconstruction_names_the_customers_area_not_the_folder_id(tmp_path: Path):
    # 00_kitchen: all 8 frames registered. 01_hallway: only 2 of 10 registered
    # (20%, under MIN_REGISTERED_RATIO) — the low-texture-hallway case this
    # message is meant to explain.
    images = [(i, f"00_kitchen/{i:05d}.jpg", (float(i), 0.0, 0.0)) for i in range(8)] + [
        (100 + i, f"01_hallway/{i:05d}.jpg", (float(i), 1.0, 0.0)) for i in range(2)
    ]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    kitchen_dir = frames_dir / "00_kitchen"
    hallway_dir = frames_dir / "01_hallway"
    kitchen_dir.mkdir(parents=True)
    hallway_dir.mkdir(parents=True)
    for i in range(8):
        (kitchen_dir / f"{i:05d}.jpg").touch()
    for i in range(10):
        (hallway_dir / f"{i:05d}.jpg").touch()

    write_capture_manifest(
        frames_dir,
        {
            "00_kitchen": CaptureEntry(role="AREA", area_name="kitchen"),
            "01_hallway": CaptureEntry(role="AREA", area_name="hallway"),
        },
    )

    with pytest.raises(PipelineError) as excinfo:
        verify_reconstruction(sparse_dir, frames_dir)

    assert excinfo.value.stage == "sfm:verify"
    assert "hallway (20% usable)" in excinfo.value.message
    assert "01_hallway" not in excinfo.value.message  # customer-facing: area name, not the internal folder id
    assert "kitchen" not in excinfo.value.message  # the passing area isn't listed as a failure
    assert "reshoot" in excinfo.value.message.lower()
