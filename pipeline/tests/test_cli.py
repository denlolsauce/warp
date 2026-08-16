from pathlib import Path

from portal_pipeline.cli import _train_config_override, build_parser
from portal_pipeline.train import TrainConfig


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


def test_extract_requires_videos_dir():
    args = build_parser().parse_args(["extract", "/some/dir"])
    assert args.videos_dir == Path("/some/dir")
    assert args.command == "extract"


def test_nav_requires_tour_id():
    args = build_parser().parse_args(["nav", "--tour-id", "abc"])
    assert args.tour_id == "abc"
