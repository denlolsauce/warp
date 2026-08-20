import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VideoRecord:
    role: str  # "OVERVIEW" | "AREA", matching the Prisma VideoRole enum's stored text
    area_name: str | None
    floor: str | None
    storage_key: str


# A fresh short-lived connection per call, not one held for the worker's
# lifetime: a single pipeline job can run for a long time (GPU training)
# between database writes, and Postgres connections held idle that long are
# liable to have been dropped by the server or an intervening proxy. These
# calls are rare and small, so reconnecting each time trades a little
# latency for not having to detect and recover a stale connection.
def _connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, autocommit=True)


def fetch_videos(database_url: str, tour_id: str) -> list[VideoRecord]:
    with _connect(database_url) as conn:
        rows = conn.execute(
            'SELECT "role", "areaName", "floor", "storageKey" FROM "Video" WHERE "tourId" = %s',
            (tour_id,),
        ).fetchall()
    if not rows:
        raise ValueError(f"no videos found for tour {tour_id}")
    return [
        VideoRecord(role=role, area_name=area_name, floor=floor, storage_key=storage_key)
        for role, area_name, floor, storage_key in rows
    ]


def start_job(database_url: str, job_id: str, stage: str) -> None:
    with _connect(database_url) as conn:
        conn.execute(
            'UPDATE "Job" SET "stage" = %s, "state" = %s, "startedAt" = %s WHERE "id" = %s',
            (stage, "running", datetime.now(timezone.utc), job_id),
        )
    logger.info("[job %s] stage=%s", job_id, stage)


def advance_job_stage(database_url: str, job_id: str, stage: str) -> None:
    with _connect(database_url) as conn:
        conn.execute('UPDATE "Job" SET "stage" = %s WHERE "id" = %s', (stage, job_id))
    logger.info("[job %s] stage=%s", job_id, stage)


def update_tour_status(database_url: str, tour_id: str, status: str) -> None:
    with _connect(database_url) as conn:
        conn.execute('UPDATE "Tour" SET "status" = %s WHERE "id" = %s', (status, tour_id))


# Terminal Job state (completed/failed) is intentionally NOT written here —
# that happens via the existing POST /api/jobs/[id]/complete callback
# (apps/web), which also owns the PUBLISHED/FAILED Tour transition and the
# tour-ready email. Duplicating that here would mean either two sources of
# truth for the terminal state or reimplementing the email side effect in
# Python for no benefit.
#
# The one exception is this fallback: if the callback itself can't be
# reached (web app down, network blip), a job would otherwise sit showing
# "running" forever with nothing to indicate it actually failed. This skips
# the email but at least leaves the status honest.
def mark_job_failed_directly(database_url: str, job_id: str, tour_id: str, error_message: str) -> None:
    with _connect(database_url) as conn:
        conn.execute(
            'UPDATE "Job" SET "state" = %s, "finishedAt" = %s, "errorMessage" = %s WHERE "id" = %s',
            ("failed", datetime.now(timezone.utc), error_message[:2000], job_id),
        )
        conn.execute('UPDATE "Tour" SET "status" = %s WHERE "id" = %s', ("FAILED", tour_id))
