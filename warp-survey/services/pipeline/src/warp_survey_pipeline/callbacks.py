"""Worker → web stage-status callbacks.

Every update carries the run's fencing token; the web app rejects stale
tokens so a superseded worker can never publish over a newer attempt.
"""

import json
import logging
import urllib.error
import urllib.request
from typing import Protocol

from .errors import PipelineError

logger = logging.getLogger(__name__)


class StatusSink(Protocol):
    def send(self, update: dict) -> None: ...

    def publish(self, update: dict) -> None: ...


class HttpStatusSink:
    """POSTs stageStatusUpdate messages to /api/v1/worker/stage-status."""

    def __init__(self, base_url: str, worker_secret: str, timeout_s: float = 10.0):
        self._url = base_url.rstrip("/") + "/api/v1/worker/stage-status"
        self._publish_url = base_url.rstrip("/") + "/api/v1/worker/publication"
        self._secret = worker_secret
        self._timeout = timeout_s

    def _post(self, url: str, body: dict) -> None:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-worker-secret": self._secret},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            resp.read()

    def send(self, update: dict) -> None:
        try:
            self._post(self._url, update)
        except urllib.error.HTTPError as e:
            if e.code == 409:
                # Stale fencing token: this worker lost its lease. Stop work.
                raise StaleLeaseError("web app rejected update: stale fencing token") from e
            logger.warning("stage-status callback failed (%s); continuing", e)
        except urllib.error.URLError as e:
            # Status delivery is best-effort; the run store is authoritative.
            logger.warning("stage-status callback unreachable (%s); continuing", e)

    def publish(self, update: dict) -> None:
        """Deliver a branch's durable outputs. Unlike status, publication is
        the run's actual product — a failure here fails the stage."""
        try:
            self._post(self._publish_url, update)
        except urllib.error.HTTPError as e:
            if e.code == 409:
                raise StaleLeaseError("web app rejected publication: stale fencing token") from e
            detail = e.read().decode("utf-8", errors="replace")[:500]
            raise PipelineError(
                f"publishing results failed ({e.code}): {detail}", transient=e.code >= 500
            ) from e
        except urllib.error.URLError as e:
            raise PipelineError(f"the web app was unreachable while publishing results ({e})", transient=True) from e


class StaleLeaseError(Exception):
    """The web app holds a newer fencing token; this worker must abandon the run."""


class CollectingStatusSink:
    """Test double that records every update."""

    def __init__(self):
        self.updates: list[dict] = []
        self.publications: list[dict] = []

    def send(self, update: dict) -> None:
        self.updates.append(update)

    def publish(self, update: dict) -> None:
        self.publications.append(update)


def publication_update(
    run_id: str,
    fencing_token: int,
    branch: str,
    artifacts: list[dict],
    provenance: dict,
    measurement_quality: dict | None = None,
    visualization_quality: dict | None = None,
    bounds: dict | None = None,
    comparison: dict | None = None,
    spatial: dict | None = None,
) -> dict:
    """Build a publicationUpdate message (validated against the shared schema)."""
    return {
        "messageVersion": 1,
        "runId": run_id,
        "fencingToken": fencing_token,
        "branch": branch,
        "artifacts": artifacts,
        "measurementQuality": measurement_quality,
        "visualizationQuality": visualization_quality,
        "bounds": bounds,
        "spatial": spatial,
        "comparison": comparison,
        "provenance": provenance,
    }


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
