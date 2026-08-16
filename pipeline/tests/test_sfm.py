from pathlib import Path

import pytest

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
