import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg

logger = logging.getLogger(__name__)

# Mirrors apps/web/src/lib/jobStateMachine.ts's STAGE_ORDER exactly — same
# contract as before (the Prisma enum's stored text is the interface, no
# shared import across the language boundary). Keep these two lists in sync
# by hand if the pipeline stages ever change.
STAGE_ORDER = [
    "INGEST",
    "FRAME_EXTRACTION",
    "POSE_ESTIMATION",
    "TRAINING",
    "CLEANUP",
    "COMPRESSION",
    "PUBLISH",
]


@dataclass(frozen=True)
class VideoRecord:
    storage_key: str
    duration_sec: float | None


@dataclass(frozen=True)
class StageRun:
    stage: str
    status: str  # StageStatus text: PENDING | RUNNING | SUCCEEDED | FAILED
    attempt: int


# A fresh short-lived connection per call, not one held for the worker's
# lifetime: a single pipeline job can run for a long time (GPU training)
# between database writes, and Postgres connections held idle that long are
# liable to have been dropped by the server or an intervening proxy. These
# calls are rare and small, so reconnecting each time trades a little
# latency for not having to detect and recover a stale connection.
def _connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, autocommit=True)


def fetch_video(database_url: str, product_id: str) -> VideoRecord:
    with _connect(database_url) as conn:
        row = conn.execute(
            'SELECT "storageKey", "durationSec" FROM "ProductVideo" WHERE "productId" = %s',
            (product_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"no video found for product {product_id}")
    storage_key, duration_sec = row
    return VideoRecord(storage_key=storage_key, duration_sec=duration_sec)


def fetch_stage_runs(database_url: str, job_id: str) -> list[StageRun]:
    with _connect(database_url) as conn:
        rows = conn.execute(
            'SELECT "stage", "status", "attempt" FROM "JobStageRun" WHERE "jobId" = %s',
            (job_id,),
        ).fetchall()
    return [StageRun(stage=stage, status=status, attempt=attempt) for stage, status, attempt in rows]


def resume_stage(stage_runs: list[StageRun]) -> str | None:
    """Mirrors apps/web/src/lib/jobStateMachine.ts's resumeStage(): the first
    stage in fixed order whose latest attempt isn't SUCCEEDED. None means
    every stage already succeeded.
    """
    latest_status_by_stage: dict[str, tuple[int, str]] = {}
    for run in stage_runs:
        current = latest_status_by_stage.get(run.stage)
        if current is None or run.attempt > current[0]:
            latest_status_by_stage[run.stage] = (run.attempt, run.status)

    for stage in STAGE_ORDER:
        status = latest_status_by_stage.get(stage, (0, "PENDING"))[1]
        if status != "SUCCEEDED":
            return stage
    return None


def start_job(database_url: str, job_id: str) -> None:
    with _connect(database_url) as conn:
        conn.execute(
            'UPDATE "Job" SET "status" = %s, "startedAt" = COALESCE("startedAt", %s) WHERE "id" = %s',
            ("RUNNING", datetime.now(timezone.utc), job_id),
        )
    logger.info("[job %s] status=RUNNING", job_id)


def update_product_status(database_url: str, product_id: str, status: str) -> None:
    with _connect(database_url) as conn:
        conn.execute('UPDATE "Product" SET "status" = %s WHERE "id" = %s', (status, product_id))


def start_stage(database_url: str, job_id: str, stage: str, attempt: int) -> None:
    # Prisma's own rows use cuid()s; this generates a plain UUID instead
    # rather than relying on the database having gen_random_uuid() available
    # (built into Postgres only since v13). Cosmetically inconsistent with
    # Prisma-created ids, but nothing depends on the id's format — it's an
    # opaque primary key either way.
    stage_run_id = str(uuid.uuid4())
    with _connect(database_url) as conn:
        conn.execute(
            """
            INSERT INTO "JobStageRun" ("id", "jobId", "stage", "attempt", "status", "startedAt")
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (stage_run_id, job_id, stage, attempt, "RUNNING", datetime.now(timezone.utc)),
        )
        conn.execute('UPDATE "Job" SET "currentStage" = %s WHERE "id" = %s', (stage, job_id))
    logger.info("[job %s] stage=%s attempt=%d status=RUNNING", job_id, stage, attempt)


def finish_stage_success(
    database_url: str, job_id: str, stage: str, attempt: int, metrics: dict | None = None
) -> None:
    with _connect(database_url) as conn:
        conn.execute(
            """
            UPDATE "JobStageRun" SET "status" = %s, "finishedAt" = %s, "metrics" = %s
            WHERE "jobId" = %s AND "stage" = %s AND "attempt" = %s
            """,
            ("SUCCEEDED", datetime.now(timezone.utc), json.dumps(metrics) if metrics else None, job_id, stage, attempt),
        )
    logger.info("[job %s] stage=%s attempt=%d status=SUCCEEDED", job_id, stage, attempt)


def finish_stage_failure(database_url: str, job_id: str, stage: str, attempt: int, error_message: str) -> None:
    with _connect(database_url) as conn:
        conn.execute(
            """
            UPDATE "JobStageRun" SET "status" = %s, "finishedAt" = %s, "errorMessage" = %s
            WHERE "jobId" = %s AND "stage" = %s AND "attempt" = %s
            """,
            ("FAILED", datetime.now(timezone.utc), error_message[:2000], job_id, stage, attempt),
        )
    logger.info("[job %s] stage=%s attempt=%d status=FAILED", job_id, stage, attempt)


# Terminal Job state (SUCCEEDED/FAILED) is intentionally NOT written here —
# that happens via the existing POST /api/jobs/[id]/complete callback
# (apps/web), which also owns the READY/FAILED Product transition and the
# product-ready email. Duplicating that here would mean either two sources
# of truth for the terminal state or reimplementing the email side effect in
# Python for no benefit.
#
# The one exception is this fallback: if the callback itself can't be
# reached (web app down, network blip), a job would otherwise sit showing
# "RUNNING" forever with nothing to indicate it actually failed. This skips
# the email but at least leaves the status honest.
def mark_job_failed_directly(database_url: str, job_id: str, product_id: str, error_message: str) -> None:
    with _connect(database_url) as conn:
        conn.execute(
            'UPDATE "Job" SET "status" = %s, "finishedAt" = %s, "errorMessage" = %s WHERE "id" = %s',
            ("FAILED", datetime.now(timezone.utc), error_message[:2000], job_id),
        )
        conn.execute('UPDATE "Product" SET "status" = %s WHERE "id" = %s', ("FAILED", product_id))
