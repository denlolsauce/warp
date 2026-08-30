from pathlib import Path

from splat_pipeline.storage import sha256_hex, upload_product_outputs


class FakeS3:
    def __init__(self):
        self.uploads: list[tuple[str, str, str, str]] = []  # (local_path, bucket, key, content_type)

    def upload_file(self, local_path, bucket, key, ExtraArgs=None):
        self.uploads.append((local_path, bucket, key, (ExtraArgs or {}).get("ContentType", "")))


def test_sha256_hex_matches_a_known_digest(tmp_path: Path):
    path = tmp_path / "f.bin"
    path.write_bytes(b"hello world")
    # sha256("hello world"), verified independently against hashlib directly.
    assert sha256_hex(path) == "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"


def test_sha256_hex_differs_for_different_content(tmp_path: Path):
    a, b = tmp_path / "a.bin", tmp_path / "b.bin"
    a.write_bytes(b"one")
    b.write_bytes(b"two")
    assert sha256_hex(a) != sha256_hex(b)


def test_upload_product_outputs_keys_are_content_hashed(tmp_path: Path):
    sog_path = tmp_path / "model.sog"
    sog_path.write_bytes(b"sog-bytes")
    ply_path = tmp_path / "cleaned.ply"
    ply_path.write_bytes(b"ply-bytes")

    s3 = FakeS3()
    assets = upload_product_outputs(s3, "my-bucket", "https://assets.example.com/", "product-1", sog_path, ply_path)

    sog_hash = sha256_hex(sog_path)
    ply_hash = sha256_hex(ply_path)
    assert assets["sog"].key == f"products/product-1/{sog_hash}.sog"
    assert assets["sog"].url == f"https://assets.example.com/products/product-1/{sog_hash}.sog"
    assert assets["sog"].content_hash == sog_hash
    assert assets["sog"].size_bytes == len(b"sog-bytes")
    assert assets["ply"].key == f"products/product-1/{ply_hash}.ply"

    uploaded_keys = {key for _, _, key, _ in s3.uploads}
    assert uploaded_keys == {assets["sog"].key, assets["ply"].key}
    assert all(bucket == "my-bucket" for _, bucket, _, _ in s3.uploads)


def test_upload_product_outputs_is_deterministic_for_identical_content(tmp_path: Path):
    # Same bytes -> same content hash, which is exactly what makes the CDN
    # URL safe to cache forever (CLAUDE.md's Publish stage). Keys still
    # differ across products (they're namespaced under products/<id>/), so
    # this compares the hash itself, not the full key.
    sog_a, sog_b = tmp_path / "a.sog", tmp_path / "b.sog"
    sog_a.write_bytes(b"identical")
    sog_b.write_bytes(b"identical")
    ply_path = tmp_path / "cleaned.ply"
    ply_path.write_bytes(b"ply-bytes")

    s3 = FakeS3()
    assets_a = upload_product_outputs(s3, "bucket", "https://assets.example.com/", "product-1", sog_a, ply_path)
    assets_b = upload_product_outputs(s3, "bucket", "https://assets.example.com/", "product-2", sog_b, ply_path)

    assert assets_a["sog"].content_hash == assets_b["sog"].content_hash
    assert assets_a["sog"].key != assets_b["sog"].key  # still namespaced per product
