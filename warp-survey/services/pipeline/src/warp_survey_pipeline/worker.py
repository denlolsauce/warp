"""Pipeline worker orchestration skeleton.

Claim job → validate message → dispatch on run kind → heartbeat thread →
stage lifecycle with structured logging.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Protocol

from .errors import PipelineError

logger = logging.getLogger(__name__)


class RunKind(str, Enum):
    """Type of processing run."""

    MEASUREMENT = "MEASUREMENT"
    VISUALIZATION = "VISUALIZATION"
    COMPARISON = "COMPARISON"


@dataclass(frozen=True)
class QueueMessage:
    """Parsed queue message."""

    run_id: str
    run_kind: RunKind
    survey_id: str
    payload: dict


@dataclass(frozen=True)
class StageAttempt:
    """Record of a stage execution attempt."""

    stage: str
    attempt: int
    elapsed_s: float


class RunStore(Protocol):
    """Protocol for persisting run state (stubbed for testing)."""

    def create_run(self, run_id: str, run_kind: RunKind, survey_id: str) -> None:
        """Create a run record."""
        ...

    def start_stage(self, run_id: str, stage: str, attempt: int) -> None:
        """Mark a stage as started."""
        ...

    def finish_stage_success(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, metrics: dict | None = None
    ) -> None:
        """Mark a stage as succeeded."""
        ...

    def finish_stage_failure(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, error_message: str
    ) -> None:
        """Mark a stage as failed."""
        ...


class InMemoryRunStore(RunStore):
    """In-memory run store for testing."""

    def __init__(self):
        self.runs: dict[str, dict] = {}

    def create_run(self, run_id: str, run_kind: RunKind, survey_id: str) -> None:
        self.runs[run_id] = {
            "kind": run_kind,
            "survey_id": survey_id,
            "stages": {},
        }

    def start_stage(self, run_id: str, stage: str, attempt: int) -> None:
        if run_id not in self.runs:
            raise ValueError(f"run {run_id} not found")
        self.runs[run_id]["stages"][f"{stage}:{attempt}"] = {"status": "RUNNING"}

    def finish_stage_success(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, metrics: dict | None = None
    ) -> None:
        if run_id not in self.runs:
            raise ValueError(f"run {run_id} not found")
        key = f"{stage}:{attempt}"
        self.runs[run_id]["stages"][key] = {"status": "SUCCEEDED", "elapsed_s": elapsed_s, "metrics": metrics}

    def finish_stage_failure(
        self, run_id: str, stage: str, attempt: int, elapsed_s: float, error_message: str
    ) -> None:
        if run_id not in self.runs:
            raise ValueError(f"run {run_id} not found")
        key = f"{stage}:{attempt}"
        self.runs[run_id]["stages"][key] = {"status": "FAILED", "elapsed_s": elapsed_s, "error": error_message}


class PipelineWorker:
    """Orchestrates pipeline stages for a claimed job."""

    # Stage order: must match app schema
    STAGE_ORDER = ["INGEST", "MEASUREMENT", "VISUALIZATION", "COMPARISON", "PUBLISH"]

    def __init__(self, store: RunStore):
        self.store = store

    def parse_message(self, raw: str) -> QueueMessage:
        """Parse and validate queue message.

        Args:
            raw: Raw JSON message from queue.

        Returns:
            Parsed message.

        Raises:
            PipelineError: On malformed or invalid message.
        """
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            raise PipelineError(f"malformed queue message: {e}", transient=False) from e

        # Required fields
        run_id = payload.get("runId")
        run_kind = payload.get("runKind")
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
        """Log structured event as JSON line."""
        record = {
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "run_id": run_id,
        }
        if stage:
            record["stage"] = stage
        record.update(kwargs)
        logger.info(json.dumps(record))

    def dispatch_run(self, message: QueueMessage) -> None:
        """Dispatch a parsed message to the appropriate handler.

        Args:
            message: Parsed queue message.

        Raises:
            NotImplementedError: Stage handlers are stubs.
            PipelineError: On validation failures.
        """
        self.store.create_run(message.run_id, message.run_kind, message.survey_id)
        self.log_structured("run_started", message.run_id, run_kind=message.run_kind.value)

        try:
            if message.run_kind == RunKind.MEASUREMENT:
                self._handle_measurement(message)
            elif message.run_kind == RunKind.VISUALIZATION:
                self._handle_visualization(message)
            elif message.run_kind == RunKind.COMPARISON:
                self._handle_comparison(message)

            self.log_structured("run_succeeded", message.run_id)
        except Exception as e:
            self.log_structured("run_failed", message.run_id, error=str(e))
            raise

    def _run_stage(self, message: QueueMessage, stage: str) -> StageAttempt:
        """Execute a single stage stub.

        Args:
            message: Queue message context.
            stage: Stage name.

        Raises:
            NotImplementedError: Always, in foundation phase.
            PipelineError: On stage-specific failures.
        """
        attempt = 1
        start = datetime.now(timezone.utc)

        self.store.start_stage(message.run_id, stage, attempt)
        self.log_structured("stage_started", message.run_id, stage=stage, attempt=attempt)

        try:
            raise NotImplementedError(f"Stage {stage} execution lands in technical-validation phase")
        except Exception as e:
            elapsed = (datetime.now(timezone.utc) - start).total_seconds()
            self.store.finish_stage_failure(message.run_id, stage, attempt, elapsed, str(e))
            self.log_structured("stage_failed", message.run_id, stage=stage, attempt=attempt, elapsed_s=elapsed)
            raise

    def _handle_measurement(self, message: QueueMessage) -> None:
        """Process a MEASUREMENT run (georeferenced reconstruction).

        Raises:
            NotImplementedError: Stub implementation.
        """
        for stage in ["INGEST", "MEASUREMENT"]:
            self._run_stage(message, stage)

    def _handle_visualization(self, message: QueueMessage) -> None:
        """Process a VISUALIZATION run (Gaussian splat).

        Raises:
            NotImplementedError: Stub implementation.
        """
        for stage in ["VISUALIZATION"]:
            self._run_stage(message, stage)

    def _handle_comparison(self, message: QueueMessage) -> None:
        """Process a COMPARISON run (multi-epoch change detection).

        Raises:
            NotImplementedError: Stub implementation.
        """
        for stage in ["COMPARISON"]:
            self._run_stage(message, stage)
