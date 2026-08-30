from pathlib import Path

import pytest

from colmap_fixtures import build_synthetic_reconstruction
from splat_pipeline.errors import PipelineError
from splat_pipeline.sfm import verify_reconstruction


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


def _write_frames(frames_dir: Path, count: int) -> None:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        (frames_dir / f"{i:05d}.jpg").touch()


def test_verify_reconstruction_passes_above_threshold(tmp_path: Path):
    images = [(i, f"{i:05d}.jpg", (float(i), 0.0, 0.0)) for i in range(9)]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    _write_frames(frames_dir, 10)  # 9/10 = 90%, above MIN_REGISTERED_RATIO (80%)

    verify_reconstruction(sparse_dir, frames_dir)  # must not raise


def test_verify_reconstruction_names_the_likely_cause_below_threshold(tmp_path: Path):
    images = [(i, f"{i:05d}.jpg", (float(i), 0.0, 0.0)) for i in range(6)]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    _write_frames(frames_dir, 10)  # 6/10 = 60%, below MIN_REGISTERED_RATIO (80%)

    with pytest.raises(PipelineError) as excinfo:
        verify_reconstruction(sparse_dir, frames_dir)

    assert excinfo.value.stage == "sfm:verify"
    assert "60%" in excinfo.value.message
    assert "moved during capture" in excinfo.value.message
