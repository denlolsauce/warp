from dataclasses import replace
from types import SimpleNamespace

import splat_pipeline.worker as worker_module
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


def test_process_job_routes_drone_profile_to_cleanup_without_sam2(monkeypatch, tmp_path):
    monkeypatch.setenv("SPLAT_WORKDIR_ROOT", str(tmp_path))
    monkeypatch.setattr(worker_module, "fetch_stage_runs", lambda *_args: [])
    monkeypatch.setattr(
        worker_module,
        "fetch_video",
        lambda *_args: SimpleNamespace(storage_key="video.mp4", capture_profile="drone"),
    )
    monkeypatch.setattr(worker_module, "start_job", lambda *_args: None)
    monkeypatch.setattr(worker_module, "update_product_status", lambda *_args: None)
    monkeypatch.setattr(worker_module, "make_s3_client", lambda *_args: object())

    def fake_download(_s3, _bucket, _key, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()

    monkeypatch.setattr(worker_module, "download_video", fake_download)
    monkeypatch.setattr(
        worker_module,
        "Sam2SegmentationBackend",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("drone cleanup must not load SAM 2")),
    )
    for stage_function in ("run_ingest", "run_extract", "run_sfm", "run_train", "run_compress"):
        monkeypatch.setattr(worker_module, stage_function, lambda *_args, **_kwargs: None)

    cleanup_calls = []
    monkeypatch.setattr(
        worker_module,
        "run_cleanup",
        lambda workdir, backend, capture_profile: cleanup_calls.append((backend, capture_profile)),
    )
    monkeypatch.setattr(worker_module, "start_stage", lambda *_args: None)
    monkeypatch.setattr(worker_module, "finish_stage_success", lambda *_args: None)
    monkeypatch.setattr(worker_module, "finish_stage_failure", lambda *_args: None)
    monkeypatch.setattr(worker_module, "upload_product_outputs", lambda *_args: {})
    monkeypatch.setattr(worker_module, "call_completion_callback", lambda *_args, **_kwargs: None)

    worker_module.process_job("job-1", "product-1", replace(_config(), sam2_checkpoint="checkpoint.pt"))

    assert cleanup_calls == [(None, "drone")]
