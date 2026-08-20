import os
import uuid

import psycopg
import pytest

from portal_pipeline.db import (
    advance_job_stage,
    fetch_videos,
    mark_job_failed_directly,
    start_job,
    update_tour_status,
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
# this machine's own recurring Docker Desktop flakiness.
pytestmark = pytest.mark.skipif(not _database_available(), reason="Postgres not reachable at DATABASE_URL")


@pytest.fixture
def seeded_tour():
    user_id = f"test-user-{uuid.uuid4()}"
    tour_id = f"test-tour-{uuid.uuid4()}"
    job_id = f"test-job-{uuid.uuid4()}"
    video_id = f"test-video-{uuid.uuid4()}"

    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute('INSERT INTO "User" (id, email) VALUES (%s, %s)', (user_id, f"{user_id}@example.com"))
        conn.execute(
            'INSERT INTO "Tour" (id, "userId", name, status) VALUES (%s, %s, %s, %s)',
            (tour_id, user_id, "Test Tour", "UPLOADED"),
        )
        conn.execute(
            'INSERT INTO "Video" (id, "tourId", role, "areaName", "floor", "storageKey") VALUES (%s, %s, %s, %s, %s, %s)',
            (video_id, tour_id, "AREA", "Kitchen", "1", "videos/test/kitchen.mp4"),
        )
        conn.execute(
            'INSERT INTO "Job" (id, "tourId", stage, state) VALUES (%s, %s, %s, %s)',
            (job_id, tour_id, "queued", "queued"),
        )

    yield {"user_id": user_id, "tour_id": tour_id, "job_id": job_id, "video_id": video_id}

    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute('DELETE FROM "Job" WHERE id = %s', (job_id,))
        conn.execute('DELETE FROM "Video" WHERE id = %s', (video_id,))
        conn.execute('DELETE FROM "Tour" WHERE id = %s', (tour_id,))
        conn.execute('DELETE FROM "User" WHERE id = %s', (user_id,))


def test_fetch_videos_returns_the_seeded_video(seeded_tour):
    videos = fetch_videos(DATABASE_URL, seeded_tour["tour_id"])
    assert len(videos) == 1
    assert videos[0].role == "AREA"
    assert videos[0].area_name == "Kitchen"
    assert videos[0].floor == "1"
    assert videos[0].storage_key == "videos/test/kitchen.mp4"


def test_fetch_videos_raises_for_a_tour_with_no_videos():
    with pytest.raises(ValueError):
        fetch_videos(DATABASE_URL, f"nonexistent-{uuid.uuid4()}")


def test_start_job_then_advance_job_stage_updates_job_row(seeded_tour):
    start_job(DATABASE_URL, seeded_tour["job_id"], "download")
    with psycopg.connect(DATABASE_URL) as conn:
        stage, state, started_at = conn.execute(
            'SELECT stage, state, "startedAt" FROM "Job" WHERE id = %s', (seeded_tour["job_id"],)
        ).fetchone()
    assert (stage, state) == ("download", "running")
    assert started_at is not None

    advance_job_stage(DATABASE_URL, seeded_tour["job_id"], "extract")
    with psycopg.connect(DATABASE_URL) as conn:
        (stage,) = conn.execute('SELECT stage FROM "Job" WHERE id = %s', (seeded_tour["job_id"],)).fetchone()
    assert stage == "extract"


def test_update_tour_status_updates_tour_row(seeded_tour):
    update_tour_status(DATABASE_URL, seeded_tour["tour_id"], "TRAINING")
    with psycopg.connect(DATABASE_URL) as conn:
        (status,) = conn.execute('SELECT status FROM "Tour" WHERE id = %s', (seeded_tour["tour_id"],)).fetchone()
    assert status == "TRAINING"


def test_mark_job_failed_directly_sets_terminal_state_on_both_rows(seeded_tour):
    mark_job_failed_directly(DATABASE_URL, seeded_tour["job_id"], seeded_tour["tour_id"], "boom")
    with psycopg.connect(DATABASE_URL) as conn:
        state, error_message, finished_at = conn.execute(
            'SELECT state, "errorMessage", "finishedAt" FROM "Job" WHERE id = %s', (seeded_tour["job_id"],)
        ).fetchone()
        (tour_status,) = conn.execute(
            'SELECT status FROM "Tour" WHERE id = %s', (seeded_tour["tour_id"],)
        ).fetchone()
    assert (state, error_message) == ("failed", "boom")
    assert finished_at is not None
    assert tour_status == "FAILED"
