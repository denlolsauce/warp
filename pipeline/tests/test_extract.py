from pathlib import Path

import cv2
import numpy as np
import pytest

from portal_pipeline.errors import PipelineError
from portal_pipeline.extract import blur_filter, parse_video_filename


@pytest.mark.parametrize(
    ("filename", "expected_role", "expected_area"),
    [
        ("overview_livingroom.mp4", "overview", "livingroom"),
        ("area_living_room.mp4", "area", "living_room"),
        ("AREA_Kitchen.mp4", "AREA", "Kitchen"),
    ],
)
def test_parse_video_filename(filename, expected_role, expected_area):
    role, area_name = parse_video_filename(Path(filename))
    assert role == expected_role
    assert area_name == expected_area


def test_parse_video_filename_without_underscore_raises():
    with pytest.raises(PipelineError) as excinfo:
        parse_video_filename(Path("noareaname.mp4"))
    assert excinfo.value.stage == "extract"


def _write_frame(path: Path, image: np.ndarray) -> None:
    cv2.imwrite(str(path), image)


def test_blur_filter_drops_bottom_20_percent(tmp_path: Path):
    sharp = (np.indices((200, 200)).sum(axis=0) % 2 * 255).astype(np.uint8)
    flat = np.full((200, 200), 128, dtype=np.uint8)

    for i in range(8):
        _write_frame(tmp_path / f"sharp_{i}.jpg", sharp)
    for i in range(2):
        _write_frame(tmp_path / f"flat_{i}.jpg", flat)

    kept, dropped = blur_filter(tmp_path)

    assert (kept, dropped) == (8, 2)
    remaining = {p.name for p in tmp_path.glob("*.jpg")}
    assert remaining == {f"sharp_{i}.jpg" for i in range(8)}


def test_blur_filter_empty_dir_raises(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        blur_filter(tmp_path)
    assert excinfo.value.stage == "extract:blur_filter"


def test_blur_filter_unreadable_frame_raises(tmp_path: Path):
    (tmp_path / "00001.jpg").write_bytes(b"not a real image")
    with pytest.raises(PipelineError) as excinfo:
        blur_filter(tmp_path)
    assert excinfo.value.stage == "extract:blur_filter"
