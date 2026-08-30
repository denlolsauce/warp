from splat_pipeline.storage import UploadedAsset
from splat_pipeline.worker import WorkerConfig, call_completion_callback


def _config() -> WorkerConfig:
    return WorkerConfig(
        database_url="postgresql://unused",
        redis_url="redis://unused",
        r2_account_id="acct",
        r2_access_key_id="key",
        r2_secret_access_key="secret",
        r2_bucket="bucket",
        r2_public_base_url="https://assets.example.com",
        app_url="https://app.example.com",
        callback_secret="s3cr3t",
        vocab_tree="vocab.bin",
        sam2_checkpoint=None,
    )


class FakeResponse:
    def raise_for_status(self) -> None:
        pass


def test_call_completion_callback_success_posts_assets_and_auth_header(monkeypatch):
    captured = {}

    def fake_post(url, json, headers, timeout):
        captured.update(url=url, json=json, headers=headers, timeout=timeout)
        return FakeResponse()

    monkeypatch.setattr("splat_pipeline.worker.requests.post", fake_post)

    assets = {
        "sog": UploadedAsset(key="products/p1/abc.sog", url="https://assets.example.com/products/p1/abc.sog", size_bytes=123, content_hash="abc"),
        "ply": UploadedAsset(key="products/p1/def.ply", url="https://assets.example.com/products/p1/def.ply", size_bytes=456, content_hash="def"),
    }
    call_completion_callback(_config(), "job-1", status="success", assets=assets)

    assert captured["url"] == "https://app.example.com/api/jobs/job-1/complete"
    assert captured["headers"] == {"x-worker-secret": "s3cr3t"}
    assert captured["json"]["status"] == "success"
    assert captured["json"]["assets"]["sog"]["key"] == "products/p1/abc.sog"
    assert captured["json"]["assets"]["sog"]["contentHash"] == "abc"
    assert "errorMessage" not in captured["json"]


def test_call_completion_callback_failure_posts_truncated_error_message(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "splat_pipeline.worker.requests.post",
        lambda url, json, headers, timeout: captured.update(json=json) or FakeResponse(),
    )

    call_completion_callback(_config(), "job-1", status="failure", error_message="boom" * 1000)

    assert captured["json"]["status"] == "failure"
    assert len(captured["json"]["errorMessage"]) == 2000
    assert "assets" not in captured["json"]
