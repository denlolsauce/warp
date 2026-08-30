import json
from pathlib import Path

import pytest

from splat_pipeline.errors import PipelineError
from splat_pipeline.pose import (
    DEFAULT_VGGT_CONFIG,
    GlomapPoseBackend,
    VggtConfig,
    VggtPoseBackend,
    select_frames,
    verify_vggt_metrics,
    vggt_runner_python,
)


def _paths(count: int) -> list[Path]:
    return [Path(f"{i:05d}.jpg") for i in range(count)]


def test_select_frames_returns_everything_below_the_cap():
    frames = _paths(40)
    assert select_frames(frames, 96) == frames


def test_select_frames_caps_at_max_frames():
    assert len(select_frames(_paths(400), 96)) == 96


def test_select_frames_spans_the_whole_capture():
    """The orbits and the top-down pass are sequential in time, so a leading
    slice would discard the capture's top/bottom coverage entirely."""
    frames = _paths(400)
    selected = select_frames(frames, 96)
    assert selected[0] == frames[0]
    assert selected[-1] == frames[-1]


def test_select_frames_preserves_capture_order():
    selected = select_frames(_paths(400), 96)
    assert selected == sorted(selected)


def test_select_frames_spacing_is_even():
    selected = select_frames(_paths(400), 100)
    indices = [int(p.stem) for p in selected]
    gaps = {b - a for a, b in zip(indices, indices[1:])}
    assert gaps <= {4, 5}  # 399/99 = 4.03; rounding gives adjacent gaps only


def test_verify_vggt_metrics_passes_above_threshold():
    verify_vggt_metrics({"frames": 96, "points": 1000, "confident_point_fraction": 0.82}, 0.5)


def test_verify_vggt_metrics_names_the_likely_cause_below_threshold():
    with pytest.raises(PipelineError) as excinfo:
        verify_vggt_metrics({"frames": 96, "points": 10, "confident_point_fraction": 0.21}, 0.5)

    assert excinfo.value.stage == "pose:vggt:verify"
    assert "21%" in excinfo.value.message
    # The merchant sees this verbatim, so it must say what to do about it.
    assert "glossy" in excinfo.value.message
    assert "reshooting" in excinfo.value.message


def test_verify_vggt_metrics_fails_when_confidence_is_missing():
    """A feed-forward estimator poses every frame unconditionally, so a
    missing confidence score leaves no quality signal at all — that must
    fail rather than pass by default."""
    with pytest.raises(PipelineError) as excinfo:
        verify_vggt_metrics({"frames": 96, "points": 1000}, 0.5)
    assert excinfo.value.stage == "pose:vggt:verify"
    assert "confidence" in excinfo.value.message


def test_vggt_runner_python_falls_back_to_plain_python(monkeypatch):
    monkeypatch.delenv("SPLAT_VGGT_PYTHON", raising=False)
    assert vggt_runner_python() == "python"


def test_vggt_runner_python_reads_env_lazily(monkeypatch):
    """Read at call time, not import time — worker.py imports this module
    before configure_tool_paths() runs."""
    monkeypatch.setenv("SPLAT_VGGT_PYTHON", "/venvs/vggt/bin/python")
    assert vggt_runner_python() == "/venvs/vggt/bin/python"


def test_vggt_backend_fails_without_frames(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        VggtPoseBackend().estimate(tmp_path)
    assert excinfo.value.stage == "pose:vggt"
    assert "frames directory not found" in excinfo.value.message


def test_vggt_backend_fails_on_empty_frames_dir(tmp_path: Path):
    (tmp_path / "frames").mkdir()
    with pytest.raises(PipelineError) as excinfo:
        VggtPoseBackend().estimate(tmp_path)
    assert excinfo.value.stage == "pose:vggt"
    assert "no frames" in excinfo.value.message


def _write_frames(workdir: Path, count: int) -> None:
    frames_dir = workdir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        (frames_dir / f"{i:05d}.jpg").touch()


def test_vggt_backend_invokes_the_runner_with_the_selected_frames(tmp_path: Path, monkeypatch):
    _write_frames(tmp_path, 200)
    captured: dict = {}

    def fake_run_command(stage: str, cmd: list[str]) -> None:
        captured["stage"] = stage
        captured["cmd"] = cmd
        flags = dict(zip(cmd[3::2], cmd[4::2]))
        captured["frames"] = json.loads(Path(flags["--frames-file"]).read_text())
        Path(flags["--metrics-path"]).write_text(json.dumps({"confident_point_fraction": 0.9}))

    monkeypatch.setattr("splat_pipeline.pose.run_command", fake_run_command)
    monkeypatch.setenv("SPLAT_VGGT_PYTHON", "/venvs/vggt/bin/python")

    VggtPoseBackend(VggtConfig(max_frames=32)).estimate(tmp_path)

    assert captured["stage"] == "pose:vggt"
    assert captured["cmd"][:3] == ["/venvs/vggt/bin/python", "-m", "splat_pipeline.vggt_runner"]
    assert len(captured["frames"]) == 32
    assert str(tmp_path / "sparse") in captured["cmd"]


def test_vggt_backend_removes_the_frame_list_after_running(tmp_path: Path, monkeypatch):
    _write_frames(tmp_path, 10)
    seen: dict = {}

    def fake_run_command(stage: str, cmd: list[str]) -> None:
        flags = dict(zip(cmd[3::2], cmd[4::2]))
        seen["frames_file"] = Path(flags["--frames-file"])
        Path(flags["--metrics-path"]).write_text(json.dumps({"confident_point_fraction": 0.9}))

    monkeypatch.setattr("splat_pipeline.pose.run_command", fake_run_command)
    VggtPoseBackend().estimate(tmp_path)
    assert not seen["frames_file"].exists()


def test_vggt_backend_cleans_up_the_frame_list_when_the_runner_fails(tmp_path: Path, monkeypatch):
    _write_frames(tmp_path, 10)
    seen: dict = {}

    def fake_run_command(stage: str, cmd: list[str]) -> None:
        flags = dict(zip(cmd[3::2], cmd[4::2]))
        seen["frames_file"] = Path(flags["--frames-file"])
        raise PipelineError(stage, "boom")

    monkeypatch.setattr("splat_pipeline.pose.run_command", fake_run_command)
    with pytest.raises(PipelineError):
        VggtPoseBackend().estimate(tmp_path)
    assert not seen["frames_file"].exists()


def test_vggt_backend_fails_when_the_runner_writes_no_metrics(tmp_path: Path, monkeypatch):
    """A zero-exit runner that produced no metrics has skipped the only
    quality gate this backend has; that is a failure, not a pass."""
    _write_frames(tmp_path, 10)
    monkeypatch.setattr("splat_pipeline.pose.run_command", lambda stage, cmd: None)

    with pytest.raises(PipelineError) as excinfo:
        VggtPoseBackend().estimate(tmp_path)
    assert excinfo.value.stage == "pose:vggt"
    assert "no metrics" in excinfo.value.message


def test_vggt_backend_propagates_a_low_confidence_verdict(tmp_path: Path, monkeypatch):
    _write_frames(tmp_path, 10)

    def fake_run_command(stage: str, cmd: list[str]) -> None:
        flags = dict(zip(cmd[3::2], cmd[4::2]))
        Path(flags["--metrics-path"]).write_text(json.dumps({"confident_point_fraction": 0.1}))

    monkeypatch.setattr("splat_pipeline.pose.run_command", fake_run_command)
    with pytest.raises(PipelineError) as excinfo:
        VggtPoseBackend().estimate(tmp_path)
    assert excinfo.value.stage == "pose:vggt:verify"


def test_glomap_backend_delegates_to_run_sfm(tmp_path: Path, monkeypatch):
    """The default path must stay byte-for-byte the behaviour it had before
    the backend interface existed."""
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(
        "splat_pipeline.pose.run_sfm", lambda workdir, vocab_tree: calls.append((workdir, vocab_tree))
    )

    GlomapPoseBackend(Path("/tree.bin")).estimate(tmp_path)
    assert calls == [(tmp_path, Path("/tree.bin"))]


def test_default_vggt_config_gates_on_confidence():
    assert DEFAULT_VGGT_CONFIG.min_confident_point_fraction > 0
