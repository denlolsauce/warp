from pathlib import Path

import pytest

from portal_pipeline.capture_manifest import (
    CaptureEntry,
    read_capture_manifest,
    write_capture_manifest,
)
from portal_pipeline.errors import PipelineError


def test_write_then_read_round_trip(tmp_path: Path):
    entries = {
        "00_livingroom": CaptureEntry(role="overview", area_name="livingroom"),
        "01_kitchen": CaptureEntry(role="area", area_name="kitchen"),
    }
    write_capture_manifest(tmp_path, entries)

    loaded = read_capture_manifest(tmp_path)
    assert loaded == entries


def test_read_missing_manifest_raises(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        read_capture_manifest(tmp_path)
    assert excinfo.value.stage == "capture_manifest"
