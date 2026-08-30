import os
import uuid

import psycopg
import pytest

from splat_pipeline.db import (
    StageRun,
    fetch_stage_runs,
    fetch_video,
    finish_stage_failure,
    finish_stage_success,
    mark_job_failed_directly,
    resume_stage,
    start_job,
    start_stage,
    update_product_status,
)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://portal:portal_dev@localhost:5432/portal")


def _database_available() -> bool:
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=2):
            return True
    except Exception:
        return False


# Real integration tests against the actual schema (matches this project's
# established preference for exercising real infra over mocks), not run
# where Postgres isn't reachable — e.g. CI without docker-compose up, or
# this machine's own recurring Docker Desktop flakiness. Also requires the
# apps/web/prisma schema's Organization/Product/Job/JobStageRun migration to
# already be applied — see CLAUDE.md's Data model section.
pytestmark = pytest.mark.skipif(not _database_available(), reason="Postgres not reachable at DATABASE_URL")


@pytest.fixture
def seeded_product():
    user_id = f"test-user-{uuid.uuid4()}"
    org_id = f"test-org-{uuid.uuid4()}"
    product_id = f"test-product-{uuid.uuid4()}"
    job_id = f"test-job-{uuid.uuid4()}"
    video_id = f"test-video-{uuid.uuid4()}"
    membership_id = f"test-membership-{uuid.uuid4()}"

    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute('INSERT INTO "User" (id, email) VALUES (%s, %s)', (user_id, f"{user_id}@example.com"))
        conn.execute(
            'INSERT INTO "Organization" (id, name, slug) VALUES (%s, %s, %s)',
            (org_id, "Test Org", org_id),
        )
        conn.execute(
            'INSERT INTO "Membership" (id, "userId", "orgId", role) VALUES (%s, %s, %s, %s)',
            (membership_id, user_id, org_id, "OWNER"),
        )
        conn.execute(
            'INSERT INTO "Product" (id, "orgId", name, status) VALUES (%s, %s, %s, %s)',
            (product_id, org_id, "Test Product", "UPLOADED"),
        )
        conn.execute(
            'INSERT INTO "ProductVideo" (id, "productId", "storageKey", "durationSec") VALUES (%s, %s, %s, %s)',
            (video_id, product_id, "videos/test/product.mp4", 90.0),
        )
        conn.execute(
            'INSERT INTO "Job" (id, "productId", status) VALUES (%s, %s, %s)',
            (job_id, product_id, "QUEUED"),
        )

    yield {"user_id": user_id, "org_id": org_id, "product_id": product_id, "job_id": job_id, "video_id": video_id}

    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute('DELETE FROM "JobStageRun" WHERE "jobId" = %s', (job_id,))
        conn.execute('DELETE FROM "Job" WHERE id = %s', (job_id,))
        conn.execute('DELETE FROM "ProductVideo" WHERE id = %s', (video_id,))
        conn.execute('DELETE FROM "Product" WHERE id = %s', (product_id,))
        conn.execute('DELETE FROM "Membership" WHERE id = %s', (membership_id,))
        conn.execute('DELETE FROM "Organization" WHERE id = %s', (org_id,))
        conn.execute('DELETE FROM "User" WHERE id = %s', (user_id,))


def test_fetch_video_returns_the_seeded_video(seeded_product):
    video = fetch_video(DATABASE_URL, seeded_product["product_id"])
    assert video.storage_key == "videos/test/product.mp4"
    assert video.duration_sec == 90.0


def test_fetch_video_raises_for_a_product_with_no_video():
    with pytest.raises(ValueError):
        fetch_video(DATABASE_URL, f"nonexistent-{uuid.uuid4()}")


def test_start_job_sets_running_and_started_at(seeded_product):
    start_job(DATABASE_URL, seeded_product["job_id"])
    with psycopg.connect(DATABASE_URL) as conn:
        status, started_at = conn.execute(
            'SELECT status, "startedAt" FROM "Job" WHERE id = %s', (seeded_product["job_id"],)
        ).fetchone()
    assert status == "RUNNING"
    assert started_at is not None


def test_start_stage_then_finish_success_records_metrics(seeded_product):
    job_id = seeded_product["job_id"]
    start_stage(DATABASE_URL, job_id, "INGEST", attempt=1)

    with psycopg.connect(DATABASE_URL) as conn:
        status, current_stage = conn.execute(
            'SELECT (SELECT status FROM "JobStageRun" WHERE "jobId" = %s AND stage = %s), '
            '(SELECT "currentStage" FROM "Job" WHERE id = %s)',
            (job_id, "INGEST", job_id),
        ).fetchone()
    assert (status, current_stage) == ("RUNNING", "INGEST")

    finish_stage_success(DATABASE_URL, job_id, "INGEST", attempt=1, metrics={"durationSec": 90.0})
    with psycopg.connect(DATABASE_URL) as conn:
        status, metrics, finished_at = conn.execute(
            'SELECT status, metrics, "finishedAt" FROM "JobStageRun" WHERE "jobId" = %s AND stage = %s',
            (job_id, "INGEST"),
        ).fetchone()
    assert status == "SUCCEEDED"
    assert metrics == {"durationSec": 90.0}
    assert finished_at is not None


def test_start_stage_then_finish_failure_records_error_message(seeded_product):
    job_id = seeded_product["job_id"]
    start_stage(DATABASE_URL, job_id, "POSE_ESTIMATION", attempt=1)
    finish_stage_failure(DATABASE_URL, job_id, "POSE_ESTIMATION", attempt=1, error_message="only 62% of frames registered")

    with psycopg.connect(DATABASE_URL) as conn:
        status, error_message = conn.execute(
            'SELECT status, "errorMessage" FROM "JobStageRun" WHERE "jobId" = %s AND stage = %s',
            (job_id, "POSE_ESTIMATION"),
        ).fetchone()
    assert status == "FAILED"
    assert error_message == "only 62% of frames registered"


def test_retried_stage_gets_a_new_row_at_the_next_attempt(seeded_product):
    job_id = seeded_product["job_id"]
    start_stage(DATABASE_URL, job_id, "TRAINING", attempt=1)
    finish_stage_failure(DATABASE_URL, job_id, "TRAINING", attempt=1, error_message="gpu OOM")
    start_stage(DATABASE_URL, job_id, "TRAINING", attempt=2)
    finish_stage_success(DATABASE_URL, job_id, "TRAINING", attempt=2)

    runs = fetch_stage_runs(DATABASE_URL, job_id)
    training_runs = sorted((r for r in runs if r.stage == "TRAINING"), key=lambda r: r.attempt)
    assert [(r.attempt, r.status) for r in training_runs] == [(1, "FAILED"), (2, "SUCCEEDED")]


def test_update_product_status_updates_product_row(seeded_product):
    update_product_status(DATABASE_URL, seeded_product["product_id"], "PROCESSING")
    with psycopg.connect(DATABASE_URL) as conn:
        (status,) = conn.execute(
            'SELECT status FROM "Product" WHERE id = %s', (seeded_product["product_id"],)
        ).fetchone()
    assert status == "PROCESSING"


def test_mark_job_failed_directly_sets_terminal_state_on_both_rows(seeded_product):
    mark_job_failed_directly(DATABASE_URL, seeded_product["job_id"], seeded_product["product_id"], "boom")
    with psycopg.connect(DATABASE_URL) as conn:
        status, error_message, finished_at = conn.execute(
            'SELECT status, "errorMessage", "finishedAt" FROM "Job" WHERE id = %s', (seeded_product["job_id"],)
        ).fetchone()
        (product_status,) = conn.execute(
            'SELECT status FROM "Product" WHERE id = %s', (seeded_product["product_id"],)
        ).fetchone()
    assert (status, error_message) == ("FAILED", "boom")
    assert finished_at is not None
    assert product_status == "FAILED"


# resume_stage() itself needs no database — pure function over StageRun
# dataclasses — but lives here rather than a standalone test module since
# it's the resumability half of this file's other tests.
def test_resume_stage_with_no_runs_starts_at_the_first_stage():
    assert resume_stage([]) == "INGEST"


def test_resume_stage_skips_succeeded_stages():
    runs = [
        StageRun(stage="INGEST", status="SUCCEEDED", attempt=1),
        StageRun(stage="FRAME_EXTRACTION", status="SUCCEEDED", attempt=1),
        StageRun(stage="POSE_ESTIMATION", status="FAILED", attempt=1),
    ]
    assert resume_stage(runs) == "POSE_ESTIMATION"


def test_resume_stage_uses_the_latest_attempt_not_the_first():
    runs = [
        StageRun(stage="TRAINING", status="FAILED", attempt=1),
        StageRun(stage="TRAINING", status="SUCCEEDED", attempt=2),
    ]
    assert resume_stage(runs) == "CLEANUP"


def test_resume_stage_returns_none_when_every_stage_succeeded():
    runs = [StageRun(stage=stage, status="SUCCEEDED", attempt=1) for stage in [
        "INGEST", "FRAME_EXTRACTION", "POSE_ESTIMATION", "TRAINING", "CLEANUP", "COMPRESSION", "PUBLISH",
    ]]
    assert resume_stage(runs) is None
