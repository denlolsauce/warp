from pathlib import Path

import pytest

from splat_pipeline.errors import PipelineError
from splat_pipeline.train import (
    DEFAULT_TRAIN_CONFIG,
    GSPLAT_BASE_MAX_STEPS,
    TrainConfig,
    effective_max_steps,
    link_images_dir,
    prepare_images_link,
    run_train,
    steps_scaler_for,
    train,
)


def test_default_train_config_matches_claude_md_targets():
    # CLAUDE.md's Training stage: "target 300k-800k for a single object" and
    # "start at 15k and tune".
    assert 300_000 <= DEFAULT_TRAIN_CONFIG.cap_max <= 800_000
    assert DEFAULT_TRAIN_CONFIG.max_steps == 15_000


def test_train_config_fields_are_overridable():
    config = TrainConfig(method="mcmc", cap_max=1, max_steps=2, sh_degree=3)
    assert (config.method, config.cap_max, config.max_steps, config.sh_degree) == ("mcmc", 1, 2, 3)


def test_shipped_config_rounds_trip_through_steps_scaler():
    # --steps-scaler is a multiplier on gsplat's own defaults, so the shipped
    # step count has to divide GSPLAT_BASE_MAX_STEPS exactly or the trainer
    # quietly runs a slightly different number of steps than asked for.
    assert effective_max_steps(steps_scaler_for(DEFAULT_TRAIN_CONFIG.max_steps)) == DEFAULT_TRAIN_CONFIG.max_steps


@pytest.fixture
def no_symlinks(monkeypatch):
    created = {}

    def fake_symlink_to(self, target, target_is_directory=False):
        created[self] = target

    monkeypatch.setattr(Path, "symlink_to", fake_symlink_to)
    return created


def test_prepare_images_link_links_frames_dir(tmp_path: Path, no_symlinks):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()

    images_link = prepare_images_link(tmp_path, frames_dir)

    assert images_link == tmp_path / "images"
    assert images_link in no_symlinks
    assert no_symlinks[images_link] == frames_dir.resolve()


def test_prepare_images_link_rejects_real_populated_dir(tmp_path: Path, no_symlinks):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    images_path = tmp_path / "images"
    images_path.mkdir()
    (images_path / "real_file.txt").write_text("not a stale reparse point")

    with pytest.raises(PipelineError) as excinfo:
        prepare_images_link(tmp_path, frames_dir)
    assert excinfo.value.stage == "train:link"


def test_prepare_images_link_cleans_up_stale_empty_dir(tmp_path: Path, no_symlinks):
    # A leftover empty images/ dir (e.g. from an interrupted prior run) should
    # not block a re-run — only a real, populated directory should.
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    (tmp_path / "images").mkdir()

    prepare_images_link(tmp_path, frames_dir)
    assert (tmp_path / "images") in no_symlinks


def test_link_images_dir_falls_back_to_junction_on_windows(tmp_path: Path, monkeypatch):
    def raise_no_privilege(self, target, target_is_directory=False):
        raise OSError("A required privilege is not held by the client")

    monkeypatch.setattr(Path, "symlink_to", raise_no_privilege)
    monkeypatch.setattr("splat_pipeline.train.os.name", "nt")

    calls = []

    def fake_run(cmd, capture_output, text):
        calls.append(cmd)

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    monkeypatch.setattr("splat_pipeline.train.subprocess.run", fake_run)

    link_images_dir(tmp_path / "images", tmp_path / "frames")

    assert calls == [["cmd", "/c", "mklink", "/J", str(tmp_path / "images"), str(tmp_path / "frames")]]


def test_link_images_dir_reraises_on_non_windows(tmp_path: Path, monkeypatch):
    def raise_no_privilege(self, target, target_is_directory=False):
        raise OSError("no symlink privilege")

    monkeypatch.setattr(Path, "symlink_to", raise_no_privilege)
    monkeypatch.setattr("splat_pipeline.train.os.name", "posix")

    with pytest.raises(OSError, match="no symlink privilege"):
        link_images_dir(tmp_path / "images", tmp_path / "frames")


def test_train_passes_steps_scaler_not_max_steps(tmp_path: Path, monkeypatch):
    # Passing --max-steps leaves MCMCStrategy.refine_stop_iter at its 25_000
    # default (simple_trainer only rescales it via cfg.steps_scaler), so the
    # strategy keeps relocating gaussians to the last step and they ship
    # unconverged. Guard the flag choice, not just the value.
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))

    config = TrainConfig(cap_max=600_000, max_steps=15_000, sh_degree=2)
    train(tmp_path, tmp_path / "out", config)

    cmd = captured[0]
    assert "--max-steps" not in cmd
    assert cmd[cmd.index("--steps-scaler") + 1] == f"{15_000 / GSPLAT_BASE_MAX_STEPS:.6f}"
    assert cmd[cmd.index("--data-dir") + 1] == str(tmp_path)


def test_train_enables_antialiasing_and_bilateral_grid_by_default(tmp_path: Path, monkeypatch):
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))

    train(tmp_path, tmp_path / "out", DEFAULT_TRAIN_CONFIG)

    assert "--antialiased" in captured[0]
    assert "--use-bilateral-grid" in captured[0]


def test_train_can_opt_out_of_the_quality_flags(tmp_path: Path, monkeypatch):
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))

    config = TrainConfig(antialiased=False, use_bilateral_grid=False)
    train(tmp_path, tmp_path / "out", config)

    assert "--no-antialiased" in captured[0]
    assert "--no-use-bilateral-grid" in captured[0]


def test_train_always_disables_gsplats_own_normalization(tmp_path: Path, monkeypatch):
    # cleanup.py's RANSAC + recentre/align/scale step is the one place meant
    # to own this transform (see train.py's own comment) — gsplat doing it
    # too would be a second, uncoordinated normalization.
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))

    train(tmp_path, tmp_path / "out", DEFAULT_TRAIN_CONFIG)

    assert "--no-normalize-world-space" in captured[0]


def test_run_train_missing_sparse_model_raises(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        run_train(tmp_path)
    assert excinfo.value.stage == "train"
    assert "sfm" in excinfo.value.message


def test_use_ppisp_disables_bilateral_grid_regardless_of_that_fields_value(tmp_path: Path, monkeypatch):
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))

    config = TrainConfig(use_ppisp=True, use_bilateral_grid=True)
    train(tmp_path, tmp_path / "out", config)

    cmd = captured[0]
    assert "--use-ppisp" in cmd
    assert "--no-use-bilateral-grid" in cmd
    assert "--use-bilateral-grid" not in cmd


def test_use_ppisp_selects_the_ppisp_venv_python(tmp_path: Path, monkeypatch):
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))
    monkeypatch.setenv("SPLAT_GSPLAT_PYTHON", "default-venv-python")
    monkeypatch.setenv("SPLAT_GSPLAT_PPISP_PYTHON", "ppisp-venv-python")

    train(tmp_path, tmp_path / "out", TrainConfig(use_ppisp=True))
    assert captured[0][0] == "ppisp-venv-python"

    captured.clear()
    train(tmp_path, tmp_path / "out", TrainConfig(use_ppisp=False))
    assert captured[0][0] == "default-venv-python"


def test_default_config_does_not_pass_ppisp_flag(tmp_path: Path, monkeypatch):
    captured: list[list[str]] = []
    monkeypatch.setattr("splat_pipeline.train.run_command", lambda stage, cmd: captured.append(cmd))

    train(tmp_path, tmp_path / "out", DEFAULT_TRAIN_CONFIG)

    assert "--use-ppisp" not in captured[0]
