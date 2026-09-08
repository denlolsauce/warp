"""Tests for reliable Redis queue claiming."""

import json
import time

import pytest

from warp_survey_pipeline.queue import Lease, ack, claim_job, heartbeat, reap_expired_leases


class FakeRedis:
    """Minimal in-memory Redis fake for testing."""

    def __init__(self):
        self._data: dict[str, str | list[str]] = {}
        self._increments: dict[str, int] = {}

    def lpush(self, key: str, value: str) -> int:
        """Push value to head of list."""
        if key not in self._data:
            self._data[key] = []
        items = self._data[key]
        if not isinstance(items, list):
            return 0
        items.insert(0, value)
        return len(items)

    def lmove(
        self, source: str, destination: str, wherefrom: str, whereto: str
    ) -> str | None:
        """Move element between lists."""
        if source not in self._data:
            return None

        items = self._data[source]
        if not isinstance(items, list) or not items:
            return None

        if wherefrom == "rpop":
            value = items.pop()
        else:
            value = items.pop(0)

        if not items:
            del self._data[source]

        if destination not in self._data:
            self._data[destination] = []

        if whereto == "lpush":
            self._data[destination].insert(0, value)
        else:
            self._data[destination].append(value)

        return value

    def lrange(self, key: str, start: int, stop: int) -> list[str]:
        """Get range of list elements."""
        if key not in self._data:
            return []
        items = self._data[key]
        if not isinstance(items, list):
            return []
        if stop == -1:
            return items[start:]
        return items[start : stop + 1]

    def lrem(self, key: str, count: int, value: str) -> int:
        """Remove elements from list."""
        if key not in self._data:
            return 0
        items = self._data[key]
        if not isinstance(items, list):
            return 0

        # Create new list without the value(s)
        original_len = len(items)
        removed_count = min(count, items.count(value))
        items[:] = [v for v in items if v != value]

        # Clean up empty list
        if len(items) == 0:
            del self._data[key]

        return removed_count

    def get(self, key: str) -> str | None:
        """Get string value."""
        value = self._data.get(key)
        return value if isinstance(value, str) else None

    def set(self, key: str, value: str, ex: int | None = None) -> bool:
        """Set string value."""
        self._data[key] = value
        if ex is not None:
            # Simulate TTL expiry (simplified: store expiry time, reaper checks it)
            self._data[f"{key}:ttl"] = str(int(time.time()) + ex)
        return True

    def incr(self, key: str) -> int:
        """Increment counter."""
        current = self._increments.get(key, 0)
        current += 1
        self._increments[key] = current
        return current

    def delete(self, *keys: str) -> int:
        """Delete keys."""
        deleted = 0
        for key in keys:
            if key in self._data:
                del self._data[key]
                deleted += 1
            if f"{key}:ttl" in self._data:
                del self._data[f"{key}:ttl"]
        return deleted

    def exists(self, key: str) -> int:
        """Check key existence."""
        return 1 if key in self._data else 0


class TestQueueClaiming:
    def test_claim_job(self):
        """Test basic job claim."""
        redis = FakeRedis()
        redis.lmove("src", "pending", "lpush", "rpush")
        redis._data["pending"] = [json.dumps({"runId": "run-1", "data": "test"})]

        message, lease = claim_job(redis, "worker-1", "pending", "inflight")
        assert message == json.dumps({"runId": "run-1", "data": "test"})
        assert lease.run_id == "run-1"
        assert lease.worker_id == "worker-1"
        assert lease.fence_token == 1

    def test_claim_job_not_found(self):
        """Test claim when queue is empty."""
        redis = FakeRedis()
        result = claim_job(redis, "worker-1", "pending", "inflight")
        assert result is None

    def test_claim_job_missing_run_id(self):
        """Test claim with malformed message (missing runId)."""
        redis = FakeRedis()
        redis._data["pending"] = [json.dumps({"data": "test"})]

        result = claim_job(redis, "worker-1", "pending", "inflight")
        assert result is None
        assert "pending" not in redis._data  # Should be cleaned up

    def test_heartbeat_extends_lease(self):
        """Test heartbeat extends expiry."""
        redis = FakeRedis()
        redis.set("warp-survey:lease:run-1", "worker-1:999999999", ex=300)

        result = heartbeat(redis, "run-1")
        assert result is True

    def test_heartbeat_nonexistent(self):
        """Test heartbeat on nonexistent lease."""
        redis = FakeRedis()
        result = heartbeat(redis, "run-1")
        assert result is False

    def test_ack(self):
        """Test job acknowledgment."""
        redis = FakeRedis()
        message = json.dumps({"runId": "run-1"})
        inflight_key = "warp-survey:jobs:inflight"
        redis._data[inflight_key] = [message]
        redis.set("warp-survey:lease:run-1", "worker-1:999999999")
        redis.set("warp-survey:lease-fence:run-1", "1")

        ack(redis, "run-1", message, inflight_key=inflight_key)
        assert inflight_key not in redis._data
        assert redis.exists("warp-survey:lease:run-1") == 0
        assert redis.exists("warp-survey:lease-fence:run-1") == 0

    def test_fence_token_monotonic(self):
        """Test fence token increments."""
        redis = FakeRedis()
        redis._data["pending"] = [
            json.dumps({"runId": "run-1"}),
            json.dumps({"runId": "run-1"}),
        ]

        _, lease1 = claim_job(redis, "worker-1", "pending", "inflight")
        assert lease1.fence_token == 1

        _, lease2 = claim_job(redis, "worker-1", "pending", "inflight")
        assert lease2.fence_token == 2

    def test_reap_expired_leases(self):
        """Test reaper moves expired leases back to pending."""
        redis = FakeRedis()
        message = json.dumps({"runId": "run-1"})
        pending_key = "warp-survey:jobs:pending"
        inflight_key = "warp-survey:jobs:inflight"
        redis._data[inflight_key] = [message]
        redis._data[pending_key] = []

        # Lease already expired
        expired_time = int(time.time()) - 10
        redis.set("warp-survey:lease:run-1", f"worker-1:{expired_time}")

        reap_expired_leases(redis, pending_key, inflight_key)

        assert redis._data.get(inflight_key) is None or not redis._data.get(inflight_key)
        assert redis._data.get(pending_key) == [message]
