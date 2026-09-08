"""Pipeline worker orchestration.

Claim job → validate message → resolve run plan from contracts' stage order →
execute stages with resume markers, status callbacks, and heartbeats. Stage
handlers receive a StageContext and return (metrics, artifact_keys, outputs);
outputs are persisted in the stage's completion marker so an interrupted run
resumes on any worker without recomputing finished stages.
"""

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Protocol

from .callbacks import StaleLeaseError, StatusSink, stage_update
from .errors import PipelineError
from .storage import ObjectStore, read_stage_marker, stage_is_complete, write_stage_marker

logger = logging.getLogger(__name__)


class RunKind(str, Enum):
    MEASUREMENT = "MEASUREMENT"
    VISUALIZATION = "VISUALIZATION"
    COMPARISON = "COMPARISON"


# Fixed stage order per kind; mirrors packages/contracts/src/jobs.ts.
STAGES: dict[RunKind, list[str]] = {
    RunKind.MEASUREMENT: [
        "INPUT_VALIDATION",
        "RECONSTRUCTION",
        "DENSE_PRODUCTS",
        "CHECKPOINT_QA",
        "PUBLISH_MEASUREMENT",
    ],
    RunKind.VISUALIZATION: [
        "CAMERA_ADAPTATION",
        "SPLAT_TRAINING",
        "TERRAIN_SAFE_CLEANUP",
        "SOG_COMPRESSION",
        "PUBLISH_VISUALIZATION",
    ],
    RunKind.COMPARISON: [
        "COMPATIBILITY_CHECKS",
        "REGISTRATION",
        "CHANGE_COMPUTATION",
        "PUBLISH_COMPARISON",
    ],
}


@dataclass(frozen=True)
class QueueMessage:
    run_id: str
    run_kind: RunKind
    survey_id: str
    payload: dict


@dataclass
class StageContext:
    """Everything a stage handler may rely on."""

    message: QueueMessage
    store: ObjectStore
    workdir: str
    # Outputs of previously completed stages, keyed by stage id.
    prior_outputs: dict[str, dict] = field(default_factory=dict)


# A handler returns (metrics, artifact_keys, outputs-for-marker).
StageHandler = Callable[[StageContext], tuple[dict, list[str], dict]]


class RunStore(Protocol):
    """Persistence for run/stage state (Postgres in production)."""

    def create_run(self, run_id: str, run_kind: RunKind, survey_id: str) -> None: ...

    def next_attempt(self, run_id: str, stage: str) -> int: ...

    def start_stage(self, run_id: str, stage: str, attempt: int) -> None: ...

    def finish_stage_success(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, metrics: dict | None = None
    ) -> None: ...

    def finish_stage_failure(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, error_message: str
    ) -> None: ...


class InMemoryRunStore(RunStore):
    """In-memory run store for testing."""

    def __init__(self):
        self.runs: dict[str, dict] = {}

    def create_run(self, run_id: str, run_kind: RunKind, survey_id: str) -> None:
        self.runs.setdefault(run_id, {"kind": run_kind, "survey_id": survey_id, "stages": {}})

    def next_attempt(self, run_id: str, stage: str) -> int:
        stages = self.runs.get(run_id, {}).get("stages", {})
        attempts = [int(k.split(":")[1]) for k in stages if k.startswith(f"{stage}:")]
        return max(attempts, default=0) + 1

    def start_stage(self, run_id: str, stage: str, attempt: int) -> None:
        if run_id not in self.runs:
            raise ValueError(f"run {run_id} not found")
        self.runs[run_id]["stages"][f"{stage}:{attempt}"] = {"status": "RUNNING"}

    def finish_stage_success(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, metrics: dict | None = None
    ) -> None:
        if run_id not in self.runs:
            raise ValueError(f"run {run_id} not found")
        self.runs[run_id]["stages"][f"{stage}:{attempt}"] = {
            "status": "SUCCEEDED",
            "elapsed_s": elapsed_s,
            "metrics": metrics,
        }

    def finish_stage_failure(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, error_message: str
    ) -> None:
        if run_id not in self.runs:
            raise ValueError(f"run {run_id} not found")
        self.runs[run_id]["stages"][f"{stage}:{attempt}"] = {
            "status": "FAILED",
            "elapsed_s": elapsed_s,
            "error": error_message,
        }


class PostgresRunStore(RunStore):
    """psycopg-backed run store writing the web app's ProcessingRun/StageAttempt
    tables directly (append-only attempts, matching the Prisma schema)."""

    def __init__(self, conninfo: str):
        import psycopg

        self._psycopg = psycopg
        self._conninfo = conninfo

    def _connect(self):
        return self._psycopg.connect(self._conninfo)

    def create_run(self, run_id: str, run_kind: RunKind, survey_id: str) -> None:
        # The web app creates the run at submission; the worker only verifies it.
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute('SELECT id FROM "ProcessingRun" WHERE id = %s', (run_id,))
            if cur.fetchone() is None:
                raise PipelineError(f"run {run_id} does not exist in the database", transient=False)

    def next_attempt(self, run_id: str, stage: str) -> int:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                'SELECT COALESCE(MAX(attempt), 0) FROM "StageAttempt" WHERE "runId" = %s AND stage = %s',
                (run_id, stage),
            )
            return int(cur.fetchone()[0]) + 1

    def start_stage(self, run_id: str, stage: str, attempt: int) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "StageAttempt" (id, "runId", stage, attempt, status, "startedAt", "createdAt") '
                "VALUES (gen_random_uuid()::text, %s, %s, %s, 'RUNNING', now(), now()) "
                'ON CONFLICT ("runId", stage, attempt) DO NOTHING',
                (run_id, stage, attempt),
            )

    def finish_stage_success(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, metrics: dict | None = None
    ) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                'UPDATE "StageAttempt" SET status = \'SUCCEEDED\', "timingSeconds" = %s, metrics = %s, '
                '"finishedAt" = now() WHERE "runId" = %s AND stage = %s AND attempt = %s AND status = \'RUNNING\'',
                (elapsed_s, json.dumps(metrics) if metrics is not None else None, run_id, stage, attempt),
            )

    def finish_stage_failure(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, error_message: str
    ) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                'UPDATE "StageAttempt" SET status = \'FAILED\', "timingSeconds" = %s, "errorMessage" = %s, '
                '"finishedAt" = now() WHERE "runId" = %s AND stage = %s AND attempt = %s AND status = \'RUNNING\'',
                (elapsed_s, error_message, run_id, stage, attempt),
            )


class HeartbeatThread:
    """Extends the run's Redis lease until stopped. If the lease vanishes
    (reaped or claimed elsewhere), sets `lost` so the worker can abandon."""

    def __init__(self, redis, run_id: str, interval_s: float = 60.0):
        from .queue import heartbeat

        self._heartbeat = heartbeat
        self._redis = redis
        self._run_id = run_id
        self._interval = interval_s
        self._stop = threading.Event()
        self.lost = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True, name=f"heartbeat-{run_id}")

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                if not self._heartbeat(self._redis, self._run_id):
                    logger.warning("lease for %s lost; signalling abandon", self._run_id)
                    self.lost.set()
                    return
            except Exception:
                logger.exception("heartbeat error for %s", self._run_id)

    def __enter__(self) -> "HeartbeatThread":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join(timeout=5)


class PipelineWorker:
    """Orchestrates pipeline stages for a claimed job."""

    def __init__(
        self,
        store: RunStore,
        object_store: ObjectStore | None = None,
        status_sink: StatusSink | None = None,
        handlers: dict[str, StageHandler] | None = None,
        workdir: str = "/tmp/warp-survey-work",
    ):
        self.store = store
        self.object_store = object_store
        self.status_sink = status_sink
        self.handlers = handlers or {}
        self.workdir = workdir
        self.fencing_token = 0

    # --- message handling ---------------------------------------------------

    def parse_message(self, raw: str) -> QueueMessage:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            raise PipelineError(f"malformed queue message: {e}", transient=False) from e

        run_id = payload.get("runId")
        run_kind = payload.get("runKind") or payload.get("kind")
        survey_id = payload.get("surveyId")
        if not all([run_id, run_kind, survey_id]):
            raise PipelineError(
                f"queue message missing required fields (runId, runKind, surveyId): {payload}",
                transient=False,
            )
        try:
            kind = RunKind(run_kind)
        except ValueError:
            raise PipelineError(f"invalid runKind: {run_kind}", transient=False)
        return QueueMessage(run_id=run_id, run_kind=kind, survey_id=survey_id, payload=payload)

    def log_structured(self, event: str, run_id: str, stage: str | None = None, **kwargs) -> None:
        record = {
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "run_id": run_id,
        }
        if stage:
            record["stage"] = stage
        record.update(kwargs)
        logger.info(json.dumps(record))

    def _send_status(self, update: dict) -> None:
        if self.status_sink is not None:
            self.status_sink.send(update)

    # --- orchestration --------------------------------------------------------

    def dispatch_run(self, message: QueueMessage) -> None:
        """Run every stage of the message's kind in order, resuming past
        stages whose completion markers already exist."""
        self.store.create_run(message.run_id, message.run_kind, message.survey_id)
        self.log_structured("run_started", message.run_id, run_kind=message.run_kind.value)

        context = StageContext(
            message=message,
            store=self.object_store,
            workdir=f"{self.workdir}/{message.run_id}",
        )

        try:
            for stage in STAGES[message.run_kind]:
                self._run_stage(context, stage)
            self.log_structured("run_succeeded", message.run_id)
        except Exception as e:
            self.log_structured("run_failed", message.run_id, error=str(e))
            raise

    def _run_stage(self, context: StageContext, stage: str) -> None:
        message = context.message

        # Resume: a durable completion marker means this stage already ran.
        if self.object_store is not None and stage_is_complete(self.object_store, message.run_id, stage):
            context.prior_outputs[stage] = read_stage_marker(self.object_store, message.run_id, stage)
            self.log_structured("stage_resumed", message.run_id, stage=stage)
            return

        handler = self.handlers.get(stage)
        if handler is None:
            raise PipelineError(
                f"no handler registered for stage {stage}; the worker deployment is incomplete",
                transient=True,
            )

        attempt = self.store.next_attempt(message.run_id, stage)
        start = time.monotonic()
        self.store.start_stage(message.run_id, stage, attempt)
        self.log_structured("stage_started", message.run_id, stage=stage, attempt=attempt)
        self._send_status(
            stage_update(message.run_id, stage, attempt, "RUNNING", self.fencing_token or 1)
        )

        try:
            metrics, artifact_keys, outputs = handler(context)
        except StaleLeaseError:
            raise
        except PipelineError as e:
            elapsed = time.monotonic() - start
            self.store.finish_stage_failure(message.run_id, stage, attempt, elapsed, e.user_message)
            self.log_structured(
                "stage_failed", message.run_id, stage=stage, attempt=attempt,
                elapsed_s=elapsed, error=e.user_message, transient=e.transient,
            )
            self._send_status(
                stage_update(
                    message.run_id, stage, attempt, "FAILED", self.fencing_token or 1,
                    error_message=e.user_message, transient=e.transient, timing_seconds=elapsed,
                )
            )
            raise
        except Exception as e:
            elapsed = time.monotonic() - start
            msg = f"unexpected error in {stage}: {e}"
            self.store.finish_stage_failure(message.run_id, stage, attempt, elapsed, msg)
            self.log_structured(
                "stage_failed", message.run_id, stage=stage, attempt=attempt, elapsed_s=elapsed, error=msg,
            )
            self._send_status(
                stage_update(
                    message.run_id, stage, attempt, "FAILED", self.fencing_token or 1,
                    error_message=msg, transient=True, timing_seconds=elapsed,
                )
            )
            raise

        elapsed = time.monotonic() - start
        if self.object_store is not None:
            write_stage_marker(self.object_store, message.run_id, stage, outputs)
        context.prior_outputs[stage] = outputs
        self.store.finish_stage_success(message.run_id, stage, attempt, elapsed, metrics)
        self.log_structured(
            "stage_succeeded",
            message.run_id,
            stage=stage,
            attempt=attempt,
            elapsed_s=elapsed,
            metrics=metrics or {},
        )
        self._send_status(
            stage_update(
                message.run_id, stage, attempt, "SUCCEEDED", self.fencing_token or 1,
                metrics=metrics, artifact_keys=artifact_keys, timing_seconds=elapsed,
            )
        )
