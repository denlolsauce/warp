import json
import logging
from pathlib import Path

import boto3

logger = logging.getLogger(__name__)

SOG_CONTENT_TYPE = "application/octet-stream"
MANIFEST_CONTENT_TYPE = "application/json"
PNG_CONTENT_TYPE = "image/png"


def make_s3_client(account_id: str, access_key_id: str, secret_access_key: str):
    # R2's S3-compatible endpoint (https://developers.cloudflare.com/r2/api/s3/api/)
    # — same endpoint shape apps/web's r2.ts uses for the upload side.
    return boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
    )


def video_storage_key_to_local_name(role: str, area_name: str | None) -> str:
    label = (area_name or role).strip().lower()
    slug = "".join(c if c.isalnum() else "_" for c in label).strip("_") or "video"
    return f"{role.lower()}_{slug}.mp4"


def download_video(s3, bucket: str, storage_key: str, dest_path: Path) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("downloading %s -> %s", storage_key, dest_path)
    s3.download_file(bucket, storage_key, str(dest_path))


def _upload(s3, bucket: str, local_path: Path, key: str, content_type: str) -> None:
    logger.info("uploading %s -> s3://%s/%s", local_path, bucket, key)
    s3.upload_file(str(local_path), bucket, key, ExtraArgs={"ContentType": content_type})


# nav.py writes manifest.json with the compress stage's LOCAL filesystem
# paths still in overview.common / overview.chunks{} / areas[].splatUrl —
# it has no reason to know where those files end up being served from. This
# uploads each referenced SOG once, rewrites those fields to the resulting
# public URL, then uploads the rewritten manifest itself. Returns the
# manifest's own public URL (what gets stored on Tour.manifestUrl and
# fetched by the viewer).
def upload_tour_outputs(
    s3, bucket: str, public_base_url: str, tour_id: str, manifest_path: Path
) -> str:
    manifest = json.loads(manifest_path.read_text())
    prefix = f"tours/{tour_id}"

    def upload_and_rewrite(local_path_str: str, content_type: str = SOG_CONTENT_TYPE) -> str:
        local_path = Path(local_path_str)
        key = f"{prefix}/{local_path.name}"
        _upload(s3, bucket, local_path, key, content_type)
        return f"{public_base_url.rstrip('/')}/{key}"

    if manifest.get("overview"):
        manifest["overview"]["common"] = upload_and_rewrite(manifest["overview"]["common"])
        manifest["overview"]["chunks"] = {
            area_id: upload_and_rewrite(path) for area_id, path in manifest["overview"]["chunks"].items()
        }

    if manifest.get("floorplanUrl"):
        manifest["floorplanUrl"] = upload_and_rewrite(manifest["floorplanUrl"], PNG_CONTENT_TYPE)

    for area in manifest["areas"]:
        area["splatUrl"] = upload_and_rewrite(area["splatUrl"])

    manifest_key = f"{prefix}/manifest.json"
    rewritten_path = manifest_path.with_name("manifest.rewritten.json")
    rewritten_path.write_text(json.dumps(manifest, indent=2))
    _upload(s3, bucket, rewritten_path, manifest_key, MANIFEST_CONTENT_TYPE)

    return f"{public_base_url.rstrip('/')}/{manifest_key}"
