from pathlib import Path

from portal_pipeline.capture_manifest import CaptureEntry, read_capture_manifest, write_capture_manifest
from portal_pipeline.db import VideoRecord
from portal_pipeline.worker import enrich_capture_manifest_with_video_records


def test_enrich_reconciles_slugified_folder_names_back_to_original_video_records(tmp_path: Path):
    # extract.py only ever sees the slugified <role>_<areaName>.mp4 filename
    # (video_storage_key_to_local_name), so "Walk-in Closet" comes back out
    # as folder area_name "walk_in_closet__2" -- this is exactly the lossy
    # round-trip enrich_capture_manifest_with_video_records exists to undo,
    # using sorted-filename order to match folders back to the real
    # VideoRecords rather than trying to reverse the slugification.
    # Filenames sort as area_kitchen < area_walk_in_closet__2 < overview_overview
    # ('a' < 'o'), so that's the index order extract.py would actually have
    # assigned -- overview lands on folder 02, not 00.
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    write_capture_manifest(
        frames_dir,
        {
            "00_kitchen": CaptureEntry(role="area", area_name="kitchen"),
            "01_walk_in_closet__2": CaptureEntry(role="area", area_name="walk_in_closet__2"),
            "02_overview": CaptureEntry(role="overview", area_name="overview"),
        },
    )

    filename_to_video = {
        "overview_overview.mp4": VideoRecord(role="OVERVIEW", area_name=None, floor=None, storage_key="k0"),
        "area_kitchen.mp4": VideoRecord(role="AREA", area_name="Kitchen", floor="1", storage_key="k1"),
        "area_walk_in_closet__2.mp4": VideoRecord(
            role="AREA", area_name="Walk-in Closet #2", floor="2", storage_key="k2"
        ),
    }

    enrich_capture_manifest_with_video_records(frames_dir, filename_to_video)

    entries = read_capture_manifest(frames_dir)
    assert entries["00_kitchen"] == CaptureEntry(role="area", area_name="Kitchen", floor="1")
    assert entries["01_walk_in_closet__2"] == CaptureEntry(role="area", area_name="Walk-in Closet #2", floor="2")
    assert entries["02_overview"] == CaptureEntry(role="overview", area_name="overview", floor=None)


def test_enrich_raises_on_a_video_count_mismatch(tmp_path: Path):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    write_capture_manifest(
        frames_dir,
        {
            "00_overview": CaptureEntry(role="overview", area_name="overview"),
            "01_kitchen": CaptureEntry(role="area", area_name="kitchen"),
        },
    )
    filename_to_video = {
        "overview_overview.mp4": VideoRecord(role="OVERVIEW", area_name=None, floor=None, storage_key="k0"),
    }

    try:
        enrich_capture_manifest_with_video_records(frames_dir, filename_to_video)
        assert False, "expected a RuntimeError"
    except RuntimeError as error:
        assert "2 folder" in str(error) and "1 video" in str(error)
