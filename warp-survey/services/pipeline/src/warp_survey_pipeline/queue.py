"""Reliable Redis claiming for language-neutral job processing.

Implements a LMOVE-based lease/claim pattern with heartbeat and reaper.
"""

import logging
import time
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)

LEASE_DURATION_S = 300  # 5 minutes


@dataclass(frozen=True)
class Lease:
    """Proof of a claimed message."""

    run_id: str
    worker_id: str
    fence_token: int


class RedisClient(Protocol):
    """Minimal redis.Redis interface for testing."""

    def lmove(
        self, source: str, destination: str, wherefrom: str, whereto: str
    ) -> str | None:
        ...

    def lpush(self, key: str, value: str) -> int:
        ...

    def get(self, key: str) -> str | None:
        ...

    def set(self, key: str, value: str, ex: int | None = None) -> bool:
        ...

    def incr(self, key: str) -> int:
        ...

    def lrange(self, key: str, start: int, stop: int) -> list[str]:
        ...

    def lrem(self, key: str, count: int, value: str) -> int:
        ...

    def delete(self, *keys: str) -> int:
        ...

    def exists(self, key: str) -> int:
        ...


def claim_job(
    redis: RedisClient, worker_id: str, pending_key: str = "warp-survey:jobs:pending",
    inflight_key: str = "warp-survey:jobs:inflight",
) -> tuple[str, Lease] | None:
    """Claim a pending job, moving it to inflight with a lease.

    Args:
        redis: Redis client.
        worker_id: Unique worker identifier.
        pending_key: List key for pending jobs.
        inflight_key: List key for in-flight jobs.

    Returns:
        (raw_message, lease) if a job was claimed, else None.
    """
    message = redis.lmove(pending_key, inflight_key, "rpop", "lpush")
    if message is None:
        return None

    # Parse run_id from message (assume JSON; caller validates schema).
    import json

    try:
        payload = json.loads(message)
        run_id = payload.get("runId")
        if not run_id:
            logger.warning("claimed message missing runId, requeuing: %s", message)
            redis.lrem(inflight_key, 1, message)
            redis.lmove(inflight_key, pending_key, "lpop", "rpush")
            return None
    except (json.JSONDecodeError, TypeError):
        logger.error("malformed message, discarding: %s", message)
        redis.lrem(inflight_key, 1, message)
        return None

    # Create lease: worker_id + expiry, and fence token.
    lease_key = f"warp-survey:lease:{run_id}"
    fence_key = f"warp-survey:lease-fence:{run_id}"

    fence_token = redis.incr(fence_key)
    lease_data = f"{worker_id}:{int(time.time()) + LEASE_DURATION_S}"
    redis.set(lease_key, lease_data, ex=LEASE_DURATION_S)

    lease = Lease(run_id=run_id, worker_id=worker_id, fence_token=fence_token)
    logger.info("claimed job %s (fence token %d)", run_id, fence_token)
    return message, lease


def heartbeat(
    redis: RedisClient, run_id: str,
    lease_key: str = "warp-survey:lease",
) -> bool:
    """Extend a job's lease expiry.

    Args:
        redis: Redis client.
        run_id: Run ID.
        lease_key: Prefix for lease key.

    Returns:
        True if heartbeat succeeded, False if lease doesn't exist (job claimed elsewhere).
    """
    full_key = f"{lease_key}:{run_id}"
    current = redis.get(full_key)
    if not current:
        return False

    redis.set(full_key, current, ex=LEASE_DURATION_S)
    return True


def ack(
    redis: RedisClient, run_id: str, message: str,
    inflight_key: str = "warp-survey:jobs:inflight",
) -> None:
    """Mark a job complete: remove from inflight and delete lease.

    Args:
        redis: Redis client.
        run_id: Run ID.
        message: The exact message string (for lrem matching).
        inflight_key: List key for in-flight jobs.
    """
    redis.lrem(inflight_key, 1, message)
    redis.delete(f"warp-survey:lease:{run_id}", f"warp-survey:lease-fence:{run_id}")
    logger.info("acked job %s", run_id)


def reap_expired_leases(
    redis: RedisClient, pending_key: str = "warp-survey:jobs:pending",
    inflight_key: str = "warp-survey:jobs:inflight",
) -> None:
    """Move jobs with expired leases back to pending.

    Args:
        redis: Redis client.
        pending_key: List key for pending jobs.
        inflight_key: List key for in-flight jobs.
    """
    messages = redis.lrange(inflight_key, 0, -1)
    now = int(time.time())
    moved_count = 0

    for message in messages:
        import json

        try:
            payload = json.loads(message)
            run_id = payload.get("runId")
        except (json.JSONDecodeError, TypeError):
            continue

        if not run_id:
            continue

        lease_data = redis.get(f"warp-survey:lease:{run_id}")
        if not lease_data:
            continue

        try:
            _, expiry_str = lease_data.split(":", 1)
            expiry = int(expiry_str)
        except (ValueError, IndexError):
            continue

        if now >= expiry:
            # Remove from inflight and re-add to pending
            removed = redis.lrem(inflight_key, 1, message)
            if removed > 0:
                redis.lpush(pending_key, message)
                moved_count += 1
                logger.info("reaped expired lease for %s", run_id)

    if moved_count > 0:
        logger.info("reaper moved %d expired jobs back to pending", moved_count)
