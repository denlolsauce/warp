"""Worker → web stage-status callbacks.

Every update carries the run's fencing token; the web app rejects stale
tokens so a superseded worker can never publish over a newer attempt.
"""

import json
import logging
import urllib.error
import urllib.request
from typing import Protocol

logger = logging.getLogger(__name__)


class StatusSink(Protocol):
    def send(self, update: dict) -> None: ...


class HttpStatusSink:
    """POSTs stageStatusUpdate messages to /api/v1/worker/stage-status."""

    def __init__(self, base_url: str, worker_secret: str, timeout_s: float = 10.0):
        self._url = base_url.rstrip("/") + "/api/v1/worker/stage-status"
        self._secret = worker_secret
        self._timeout = timeout_s

    def send(self, update: dict) -> None:
        body = json.dumps(update).encode("utf-8")
        req = urllib.request.Request(
            self._url,
            data=body,
            headers={"Content-Type": "application/json", "x-worker-secret": self._secret},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 409:
                # Stale fencing token: this worker lost its lease. Stop work.
                raise StaleLeaseError("web app rejected update: stale fencing token") from e
            logger.warning("stage-status callback failed (%s); continuing", e)
        except urllib.error.URLError as e:
            # Status delivery is best-effort; the run store is authoritative.
            logger.warning("stage-status callback unreachable (%s); continuing", e)


class StaleLeaseError(Exception):
    """The web app holds a newer fencing token; this worker must abandon the run."""


class CollectingStatusSink:
    """Test double that records every update."""

    def __init__(self):
        self.updates: list[dict] = []

    def send(self, update: dict) -> None:
        self.updates.append(update)


def stage_update(
    run_id: str,
    stage: str,
    attempt: int,
    status: str,
    fencing_token: int,
    error_message: str | None = None,
    transient: bool | None = None,
    metrics: dict | None = None,
    artifact_keys: list[str] | None = None,
    timing_seconds: float | None = None,
) -> dict:
    """Build a stageStatusUpdate message (validated against the shared schema)."""
    return {
        "messageVersion": 1,
        "runId": run_id,
        "stage": stage,
        "attempt": attempt,
        "status": status,
        "fencingToken": fencing_token,
        "errorMessage": error_message,
        "transient": transient,
        "metrics": metrics,
        "artifactKeys": artifact_keys or [],
        "timingSeconds": timing_seconds,
    }
