"""Worker entrypoint: claim loop with lease heartbeats and reaping.

    python -m warp_survey_pipeline.main

Environment:
    REDIS_URL, DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY,
    S3_BUCKET, WEB_BASE_URL, WORKER_CALLBACK_SECRET, WORKER_ID (optional).
"""

import logging
import os
import signal
import socket
import sys
import time
import uuid

from .callbacks import HttpStatusSink, StaleLeaseError
from .errors import PipelineError
from .handlers import DEFAULT_HANDLERS
from .queue import ack, claim_job, reap_expired_leases
from .storage import S3ObjectStore
from .worker import HeartbeatThread, PipelineWorker, PostgresRunStore

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 5.0
REAP_INTERVAL_S = 60.0


def build_worker() -> tuple[PipelineWorker, object]:
    import boto3
    import redis as redis_lib

    redis = redis_lib.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )
    object_store = S3ObjectStore(s3, os.environ["S3_BUCKET"])
    run_store = PostgresRunStore(os.environ["DATABASE_URL"])
    status_sink = HttpStatusSink(
        base_url=os.environ["WEB_BASE_URL"],
        worker_secret=os.environ["WORKER_CALLBACK_SECRET"],
    )
    worker = PipelineWorker(
        store=run_store,
        object_store=object_store,
        status_sink=status_sink,
        handlers=DEFAULT_HANDLERS,
        workdir=os.environ.get("WORK_DIR", "/tmp/warp-survey-work"),
    )
    return worker, redis


def main() -> None:
    worker_id = os.environ.get("WORKER_ID") or f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
    worker, redis = build_worker()
    logger.info("worker %s started", worker_id)

    shutting_down = False

    def _shutdown(signum, _frame):
        nonlocal shutting_down
        logger.info("received signal %s; finishing current job then exiting", signum)
        shutting_down = True

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    last_reap = 0.0
    while not shutting_down:
        now = time.monotonic()
        if now - last_reap >= REAP_INTERVAL_S:
            try:
                reap_expired_leases(redis)
            except Exception:
                logger.exception("reaper failed; continuing")
            last_reap = now

        claimed = None
        try:
            claimed = claim_job(redis, worker_id)
        except Exception:
            logger.exception("claim failed; backing off")
            time.sleep(POLL_INTERVAL_S)
            continue

        if claimed is None:
            time.sleep(POLL_INTERVAL_S)
            continue

        raw, lease = claimed
        worker.fencing_token = lease.fence_token
        try:
            message = worker.parse_message(raw)
            with HeartbeatThread(redis, message.run_id) as hb:
                worker.dispatch_run(message)
                if hb.lost.is_set():
                    logger.warning("lease lost during run %s; not acking", message.run_id)
                    continue
            ack(redis, message.run_id, raw)
        except StaleLeaseError:
            logger.warning("run %s superseded by a newer worker; abandoning without ack", lease.run_id)
        except PipelineError as e:
            # The failure is recorded on the run; permanent failures should not
            # be retried, so ack either way — retry policy is the web app's call.
            if not e.transient:
                ack(redis, lease.run_id, raw)
            logger.error("run %s failed: %s (transient=%s)", lease.run_id, e.user_message, e.transient)
        except Exception:
            logger.exception("run %s crashed; leaving message for the reaper", lease.run_id)

    logger.info("worker %s stopped", worker_id)


if __name__ == "__main__":
    main()
