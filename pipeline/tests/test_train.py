import asyncio
from pathlib import Path

import numpy as np
import pycolmap
import pytest

from colmap_fixtures import build_synthetic_reconstruction
from portal_pipeline.errors import PipelineError
from portal_pipeline.train import (
    AREA_TRAIN_CONFIG,
    OVERVIEW_TRAIN_CONFIG,
    TrainConfig,
    default_train_config,
    detect_gpu_count,
    link_images_dir,
    split_reconstruction,
    train_all,
)


def test_default_train_config_by_role():
    assert default_train_config("overview") is OVERVIEW_TRAIN_CONFIG
    assert default_train_config("OVERVIEW") is OVERVIEW_TRAIN_CONFIG
    assert default_train_config("area") is AREA_TRAIN_CONFIG
    assert default_train_config("anything_else") is AREA_TRAIN_CONFIG


def test_train_config_fields_are_overridable():
    config = TrainConfig(method="mcmc", cap_max=1, max_steps=2, sh_degree=3)
    assert (config.method, config.cap_max, config.max_steps, config.sh_degree) == ("mcmc", 1, 2, 3)


@pytest.fixture
def no_symlinks(monkeypatch):
    created = {}

    def fake_symlink_to(self, target, target_is_directory=False):
        created[self] = target

    monkeypatch.setattr(Path, "symlink_to", fake_symlink_to)
    return created


def test_split_reconstruction_preserves_global_frame(tmp_path: Path, no_symlinks):
    images = [
        (1, "00_a/00001.jpg", (0.0, 0.0, 0.0)),
        (2, "00_a/00002.jpg", (1.0, 0.0, 0.0)),
        (3, "01_b/00001.jpg", (10.0, 0.0, 0.0)),
        (4, "01_b/00002.jpg", (11.0, 0.0, 0.0)),
    ]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    (frames_dir / "00_a").mkdir(parents=True)
    (frames_dir / "01_b").mkdir(parents=True)

    sub_dir = tmp_path / "sub"
    split_reconstruction(sparse_dir, frames_dir, sub_dir, ["00_a", "01_b"])

    sub_a = pycolmap.Reconstruction(str(sub_dir / "00_a" / "sparse" / "0"))
    names_a = sorted(img.name for img in sub_a.images.values())
    assert names_a == ["00_a/00001.jpg", "00_a/00002.jpg"]

    original_center = np.array(full.images[1].projection_center())
    split_center = np.array(sub_a.images[1].projection_center())
    assert np.allclose(original_center, split_center)

    sub_b = pycolmap.Reconstruction(str(sub_dir / "01_b" / "sparse" / "0"))
    names_b = sorted(img.name for img in sub_b.images.values())
    assert names_b == ["01_b/00001.jpg", "01_b/00002.jpg"]


def test_split_reconstruction_links_images_dir(tmp_path: Path, no_symlinks):
    images = [
        (1, "00_a/00001.jpg", (0.0, 0.0, 0.0)),
        (2, "00_a/00002.jpg", (1.0, 0.0, 0.0)),
    ]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    (frames_dir / "00_a").mkdir(parents=True)

    sub_dir = tmp_path / "sub"
    split_reconstruction(sparse_dir, frames_dir, sub_dir, ["00_a"])

    images_link = sub_dir / "00_a" / "images"
    assert images_link in no_symlinks
    assert no_symlinks[images_link] == frames_dir.resolve()


def test_split_reconstruction_rejects_real_dir_at_images_path(tmp_path: Path, no_symlinks):
    images = [(1, "00_a/00001.jpg", (0.0, 0.0, 0.0)), (2, "00_a/00002.jpg", (1.0, 0.0, 0.0))]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    (frames_dir / "00_a").mkdir(parents=True)

    sub_dir = tmp_path / "sub"
    images_path = sub_dir / "00_a" / "images"
    images_path.mkdir(parents=True)
    (images_path / "real_file.txt").write_text("not a stale reparse point")

    with pytest.raises(PipelineError) as excinfo:
        split_reconstruction(sparse_dir, frames_dir, sub_dir, ["00_a"])
    assert excinfo.value.stage == "train:split"


def test_split_reconstruction_cleans_up_stale_empty_images_dir(tmp_path: Path, no_symlinks):
    # A leftover empty images/ dir (e.g. from an interrupted prior run) should
    # not block a re-run — only a real, populated directory should.
    images = [(1, "00_a/00001.jpg", (0.0, 0.0, 0.0)), (2, "00_a/00002.jpg", (1.0, 0.0, 0.0))]
    full = build_synthetic_reconstruction(images)
    sparse_dir = tmp_path / "sparse"
    (sparse_dir / "0").mkdir(parents=True)
    full.write(str(sparse_dir / "0"))

    frames_dir = tmp_path / "frames"
    (frames_dir / "00_a").mkdir(parents=True)

    sub_dir = tmp_path / "sub"
    (sub_dir / "00_a" / "images").mkdir(parents=True)

    split_reconstruction(sparse_dir, frames_dir, sub_dir, ["00_a"])
    assert (sub_dir / "00_a" / "images") in no_symlinks


def test_train_all_respects_gpu_semaphore(tmp_path: Path, monkeypatch):
    in_flight = 0
    max_in_flight = 0
    calls: list[str] = []

    async def fake_run_command_async(stage: str, cmd: list[str]) -> None:
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        calls.append(stage)
        await asyncio.sleep(0.01)
        in_flight -= 1

    monkeypatch.setattr("portal_pipeline.train.run_command_async", fake_run_command_async)

    configs = {f"{i:02d}_area": AREA_TRAIN_CONFIG for i in range(5)}
    asyncio.run(train_all(tmp_path / "sub", tmp_path / "out", configs, gpu_count=2))

    assert max_in_flight == 2
    assert len(calls) == 5


def test_detect_gpu_count_is_at_least_one():
    assert detect_gpu_count() >= 1


def test_link_images_dir_falls_back_to_junction_on_windows(tmp_path: Path, monkeypatch):
    def raise_no_privilege(self, target, target_is_directory=False):
        raise OSError("A required privilege is not held by the client")

    monkeypatch.setattr(Path, "symlink_to", raise_no_privilege)
    monkeypatch.setattr("portal_pipeline.train.os.name", "nt")

    calls = []

    def fake_run(cmd, capture_output, text):
        calls.append(cmd)

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    monkeypatch.setattr("portal_pipeline.train.subprocess.run", fake_run)

    link_images_dir(tmp_path / "images", tmp_path / "frames")

    assert calls == [["cmd", "/c", "mklink", "/J", str(tmp_path / "images"), str(tmp_path / "frames")]]


def test_link_images_dir_reraises_on_non_windows(tmp_path: Path, monkeypatch):
    def raise_no_privilege(self, target, target_is_directory=False):
        raise OSError("no symlink privilege")

    monkeypatch.setattr(Path, "symlink_to", raise_no_privilege)
    monkeypatch.setattr("portal_pipeline.train.os.name", "posix")

    with pytest.raises(OSError, match="no symlink privilege"):
        link_images_dir(tmp_path / "images", tmp_path / "frames")
