import json
from pathlib import Path

from portal_pipeline.storage import upload_tour_outputs, video_storage_key_to_local_name


def test_local_name_for_area_video_slugifies_area_name():
    assert video_storage_key_to_local_name("AREA", "Kitchen") == "area_kitchen.mp4"


def test_local_name_for_area_video_replaces_non_alnum_characters():
    assert video_storage_key_to_local_name("AREA", "Walk-in Closet #2") == "area_walk_in_closet__2.mp4"


def test_local_name_for_overview_video_falls_back_to_role():
    # Video.areaName is NULL for the overview row — extract.py's
    # <role>_<areaName>.mp4 convention still needs something non-empty
    # after the underscore.
    assert video_storage_key_to_local_name("OVERVIEW", None) == "overview_overview.mp4"


class FakeS3:
    def __init__(self):
        self.uploads: list[tuple[str, str, str, str]] = []  # (local_path, bucket, key, content_type)

    def upload_file(self, local_path, bucket, key, ExtraArgs=None):
        self.uploads.append((local_path, bucket, key, (ExtraArgs or {}).get("ContentType", "")))


def test_upload_tour_outputs_rewrites_local_paths_to_public_urls(tmp_path: Path):
    common = tmp_path / "00_overview.sog"
    common.write_bytes(b"common")
    chunk = tmp_path / "chunk_room_a.sog"
    chunk.write_bytes(b"chunk")
    area = tmp_path / "01_room_a.sog"
    area.write_bytes(b"area")

    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "tourId": "tour-1",
                "overview": {"common": str(common), "chunks": {"01_room_a": str(chunk)}},
                "areas": [{"id": "01_room_a", "splatUrl": str(area)}],
            }
        )
    )

    s3 = FakeS3()
    result_url = upload_tour_outputs(s3, "my-bucket", "https://assets.example.com/", "tour-1", manifest_path)

    assert result_url == "https://assets.example.com/tours/tour-1/manifest.json"

    uploaded_keys = {key for _, _, key, _ in s3.uploads}
    assert uploaded_keys == {
        "tours/tour-1/00_overview.sog",
        "tours/tour-1/chunk_room_a.sog",
        "tours/tour-1/01_room_a.sog",
        "tours/tour-1/manifest.json",
    }
    assert all(bucket == "my-bucket" for _, bucket, _, _ in s3.uploads)

    manifest_upload = next(local for local, _, key, _ in s3.uploads if key == "tours/tour-1/manifest.json")
    rewritten = json.loads(Path(manifest_upload).read_text())
    assert rewritten["overview"]["common"] == "https://assets.example.com/tours/tour-1/00_overview.sog"
    assert rewritten["overview"]["chunks"]["01_room_a"] == "https://assets.example.com/tours/tour-1/chunk_room_a.sog"
    assert rewritten["areas"][0]["splatUrl"] == "https://assets.example.com/tours/tour-1/01_room_a.sog"
