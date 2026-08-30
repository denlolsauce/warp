import hashlib
import logging
from pathlib import Path

import boto3

logger = logging.getLogger(__name__)

SOG_CONTENT_TYPE = "application/octet-stream"
PLY_CONTENT_TYPE = "application/octet-stream"


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


def download_video(s3, bucket: str, storage_key: str, dest_path: Path) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info("downloading %s -> %s", storage_key, dest_path)
    s3.download_file(bucket, storage_key, str(dest_path))


def sha256_hex(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _upload(s3, bucket: str, local_path: Path, key: str, content_type: str) -> None:
    logger.info("uploading %s -> s3://%s/%s", local_path, bucket, key)
    s3.upload_file(str(local_path), bucket, key, ExtraArgs={"ContentType": content_type})


class UploadedAsset:
    def __init__(self, key: str, url: str, size_bytes: int, content_hash: str) -> None:
        self.key = key
        self.url = url
        self.size_bytes = size_bytes
        self.content_hash = content_hash


# CLAUDE.md's Publish stage: "immutable content-hashed URLs" — the hash goes
# in the key itself, not just a cache-busting query param, so the SOG can
# carry a long/immutable cache TTL safely: the URL only ever points at one
# fixed set of bytes.
def upload_content_hashed(s3, bucket: str, public_base_url: str, product_id: str, local_path: Path, content_type: str) -> UploadedAsset:
    content_hash = sha256_hex(local_path)
    key = f"products/{product_id}/{content_hash}{local_path.suffix}"
    _upload(s3, bucket, local_path, key, content_type)
    size_bytes = local_path.stat().st_size
    url = f"{public_base_url.rstrip('/')}/{key}"
    return UploadedAsset(key=key, url=url, size_bytes=size_bytes, content_hash=content_hash)


def upload_product_outputs(s3, bucket: str, public_base_url: str, product_id: str, sog_path: Path, ply_path: Path) -> dict[str, UploadedAsset]:
    return {
        "sog": upload_content_hashed(s3, bucket, public_base_url, product_id, sog_path, SOG_CONTENT_TYPE),
        "ply": upload_content_hashed(s3, bucket, public_base_url, product_id, ply_path, PLY_CONTENT_TYPE),
    }
