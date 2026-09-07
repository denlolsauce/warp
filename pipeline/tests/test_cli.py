from pathlib import Path

import pytest

from splat_pipeline.cli import _train_config_override, build_parser
from splat_pipeline.train import TrainConfig


def test_train_config_override_none_when_no_flags_given():
    args = build_parser().parse_args(["train"])
    assert _train_config_override(args) is None


def test_train_config_override_partial_falls_back_to_dataclass_defaults():
    args = build_parser().parse_args(["train", "--cap-max", "999"])
    override = _train_config_override(args)
    default = TrainConfig()
    assert override == TrainConfig(
        method=default.method, cap_max=999, max_steps=default.max_steps, sh_degree=default.sh_degree
    )


def test_train_config_override_all_fields():
    args = build_parser().parse_args(
        ["train", "--method", "adc", "--cap-max", "1", "--max-steps", "2", "--sh-degree", "3"]
    )
    assert _train_config_override(args) == TrainConfig(method="adc", cap_max=1, max_steps=2, sh_degree=3)


def test_ingest_requires_video_path():
    args = build_parser().parse_args(["ingest", "/some/video.mp4"])
    assert args.video_path == Path("/some/video.mp4")
    assert args.command == "ingest"


def test_extract_requires_video_path():
    args = build_parser().parse_args(["extract", "/some/video.mp4"])
    assert args.video_path == Path("/some/video.mp4")
    assert args.command == "extract"


def test_sfm_requires_vocab_tree():
    args = build_parser().parse_args(["sfm", "--vocab-tree", "/tree.bin"])
    assert args.vocab_tree == Path("/tree.bin")


def test_cleanup_sam2_checkpoint_defaults_to_none():
    args = build_parser().parse_args(["cleanup"])
    assert args.sam2_checkpoint is None


def test_cleanup_accepts_sam2_checkpoint():
    args = build_parser().parse_args(["cleanup", "--sam2-checkpoint", "/ckpt.pt"])
    assert args.sam2_checkpoint == Path("/ckpt.pt")


def test_monitor_takes_two_captures_and_their_control_points():
    args = build_parser().parse_args(
        [
            "monitor", "/base.ply", "/repeat.ply",
            "--baseline-gcps", "/base.json",
            "--repeat-gcps", "/repeat.json",
            "--workdir", "/work",
        ]
    )
    assert args.command == "monitor"
    assert (args.baseline_ply, args.repeat_ply) == (Path("/base.ply"), Path("/repeat.ply"))
    assert (args.baseline_gcps, args.repeat_gcps) == (Path("/base.json"), Path("/repeat.json"))


def test_monitor_requires_control_points_for_both_captures():
    # Without GCPs there is no scale, so every distance the report would
    # quote in metres is meaningless — this must not be defaultable.
    with pytest.raises(SystemExit):
        build_parser().parse_args(["monitor", "/base.ply", "/repeat.ply", "--baseline-gcps", "/base.json"])
