"""Tests for pipeline worker orchestration."""

import json

import pytest

from warp_survey_pipeline.callbacks import CollectingStatusSink
from warp_survey_pipeline.errors import PipelineError
from warp_survey_pipeline.storage import InMemoryObjectStore, write_stage_marker
from warp_survey_pipeline.worker import (
    STAGES,
    InMemoryRunStore,
    PipelineWorker,
    QueueMessage,
    RunKind,
)


def _ok_handler(name):
    def handler(context):
        return {"stage": name}, [f"runs/{context.message.run_id}/{name}/out"], {"done": name}

    return handler


def make_worker(store, object_store=None, sink=None, handlers=None, kind=RunKind.MEASUREMENT):
    if handlers is None:
        handlers = {stage: _ok_handler(stage) for stage in STAGES[kind]}
    return PipelineWorker(store, object_store=object_store, status_sink=sink, handlers=handlers)


class TestParseMessage:
    @pytest.fixture
    def worker(self):
        return PipelineWorker(InMemoryRunStore())

    def test_parse_message_valid(self, worker):
        raw = json.dumps(
            {
                "runId": "run-123",
                "runKind": "MEASUREMENT",
                "surveyId": "survey-456",
                "data": {"image_count": 50},
            }
        )
        message = worker.parse_message(raw)
        assert message.run_id == "run-123"
        assert message.run_kind == RunKind.MEASUREMENT
        assert message.survey_id == "survey-456"
        assert message.payload["data"]["image_count"] == 50

    def test_parse_message_accepts_kind_alias(self, worker):
        """The web app enqueues `kind`; the worker accepts both spellings."""
        raw = json.dumps({"runId": "r", "kind": "COMPARISON", "surveyId": "s"})
        assert worker.parse_message(raw).run_kind == RunKind.COMPARISON

    def test_parse_message_malformed_json(self, worker):
        with pytest.raises(PipelineError, match="malformed"):
            worker.parse_message("not json")

    def test_parse_message_missing_run_id(self, worker):
        raw = json.dumps({"runKind": "MEASUREMENT", "surveyId": "survey-456"})
        with pytest.raises(PipelineError, match="required fields"):
            worker.parse_message(raw)

    def test_parse_message_missing_run_kind(self, worker):
        raw = json.dumps({"runId": "run-123", "surveyId": "survey-456"})
        with pytest.raises(PipelineError, match="required fields"):
            worker.parse_message(raw)

    def test_parse_message_missing_survey_id(self, worker):
        raw = json.dumps({"runId": "run-123", "runKind": "MEASUREMENT"})
        with pytest.raises(PipelineError, match="requires a surveyId"):
            worker.parse_message(raw)

    def test_comparison_message_needs_no_survey_id(self, worker):
        """A comparison spans two surveys and carries a comparisonId instead."""
        raw = json.dumps(
            {
                "runId": "run-1",
                "kind": "COMPARISON",
                "surveyId": None,
                "comparisonId": "cmp-1",
                "payload": {"method": "M3C2"},
            }
        )
        message = worker.parse_message(raw)
        assert message.run_kind == RunKind.COMPARISON
        assert message.payload["comparisonId"] == "cmp-1"
        assert message.payload["method"] == "M3C2"

    def test_stage_inputs_come_from_the_nested_payload(self, worker):
        raw = json.dumps(
            {
                "runId": "run-1",
                "kind": "MEASUREMENT",
                "surveyId": "survey-1",
                "payload": {"imageKeys": ["a.jpg", "b.jpg"], "crs": "EPSG:25832"},
            }
        )
        message = worker.parse_message(raw)
        assert message.payload["imageKeys"] == ["a.jpg", "b.jpg"]
        assert message.payload["crs"] == "EPSG:25832"

    def test_parse_message_invalid_run_kind(self, worker):
        raw = json.dumps({"runId": "run-123", "runKind": "INVALID_KIND", "surveyId": "survey-456"})
        with pytest.raises(PipelineError, match="invalid runKind"):
            worker.parse_message(raw)


class TestDispatch:
    @pytest.fixture
    def store(self):
        return InMemoryRunStore()

    @pytest.fixture
    def object_store(self):
        return InMemoryObjectStore()

    @pytest.fixture
    def sink(self):
        return CollectingStatusSink()

    def test_measurement_run_executes_all_stages_in_order(self, store, object_store, sink):
        worker = make_worker(store, object_store, sink)
        message = QueueMessage("run-1", RunKind.MEASUREMENT, "survey-1", {})
        worker.dispatch_run(message)

        stages = store.runs["run-1"]["stages"]
        for stage in STAGES[RunKind.MEASUREMENT]:
            assert stages[f"{stage}:1"]["status"] == "SUCCEEDED"

        # Status callbacks: RUNNING + SUCCEEDED per stage, in stage order.
        succeeded = [u["stage"] for u in sink.updates if u["status"] == "SUCCEEDED"]
        assert succeeded == list(STAGES[RunKind.MEASUREMENT])

    def test_visualization_and_comparison_stage_sets(self, store, object_store):
        for kind in (RunKind.VISUALIZATION, RunKind.COMPARISON):
            worker = make_worker(store, object_store, kind=kind)
            message = QueueMessage(f"run-{kind.value}", kind, "survey-1", {})
            worker.dispatch_run(message)
            stages = store.runs[f"run-{kind.value}"]["stages"]
            assert all(stages[f"{s}:1"]["status"] == "SUCCEEDED" for s in STAGES[kind])

    def test_missing_handler_is_transient_failure(self, store, object_store):
        worker = make_worker(store, object_store, handlers={})
        message = QueueMessage("run-1", RunKind.MEASUREMENT, "survey-1", {})
        with pytest.raises(PipelineError, match="no handler"):
            worker.dispatch_run(message)
        assert "run-1" in store.runs

    def test_stage_failure_records_reason_and_stops(self, store, object_store, sink):
        handlers = {stage: _ok_handler(stage) for stage in STAGES[RunKind.MEASUREMENT]}

        def failing(context):
            raise PipelineError("only 62% of images registered", transient=False)

        handlers["RECONSTRUCTION"] = failing
        worker = make_worker(store, object_store, sink, handlers=handlers)
        message = QueueMessage("run-1", RunKind.MEASUREMENT, "survey-1", {})

        with pytest.raises(PipelineError, match="62%"):
            worker.dispatch_run(message)

        stages = store.runs["run-1"]["stages"]
        assert stages["RECONSTRUCTION:1"]["status"] == "FAILED"
        assert "62%" in stages["RECONSTRUCTION:1"]["error"]
        # Later stages never started.
        assert "DENSE_PRODUCTS:1" not in stages
        failed = [u for u in sink.updates if u["status"] == "FAILED"]
        assert failed[0]["transient"] is False
        assert "62%" in failed[0]["errorMessage"]

    def test_resume_skips_completed_stages(self, store, object_store):
        """A restarted worker resumes from durable stage markers instead of
        recomputing finished stages."""
        calls = []

        def tracking(name):
            def handler(context):
                calls.append(name)
                return {}, [], {"done": name}

            return handler

        handlers = {stage: tracking(stage) for stage in STAGES[RunKind.MEASUREMENT]}
        # Pretend the first two stages already completed on another worker.
        write_stage_marker(object_store, "run-1", "INPUT_VALIDATION", {"done": "INPUT_VALIDATION"})
        write_stage_marker(object_store, "run-1", "RECONSTRUCTION", {"done": "RECONSTRUCTION", "artifacts": {}})

        worker = make_worker(store, object_store, handlers=handlers)
        message = QueueMessage("run-1", RunKind.MEASUREMENT, "survey-1", {})
        worker.dispatch_run(message)

        assert calls == ["DENSE_PRODUCTS", "CHECKPOINT_QA", "PUBLISH_MEASUREMENT"]

    def test_resumed_outputs_visible_to_later_stages(self, store, object_store):
        write_stage_marker(object_store, "run-1", "INPUT_VALIDATION", {"imageKeys": ["a.jpg"]})
        seen = {}

        def check(context):
            seen.update(context.prior_outputs)
            return {}, [], {}

        handlers = {stage: check for stage in STAGES[RunKind.MEASUREMENT]}
        worker = make_worker(store, object_store, handlers=handlers)
        worker.dispatch_run(QueueMessage("run-1", RunKind.MEASUREMENT, "survey-1", {}))
        assert seen["INPUT_VALIDATION"] == {"imageKeys": ["a.jpg"]}

    def test_retry_creates_new_attempt(self, store, object_store):
        attempts = []

        def flaky(context):
            attempts.append(1)
            if len(attempts) == 1:
                raise PipelineError("transient blip", transient=True)
            return {}, [], {}

        handlers = {stage: _ok_handler(stage) for stage in STAGES[RunKind.COMPARISON]}
        handlers["COMPATIBILITY_CHECKS"] = flaky
        worker = make_worker(store, object_store, handlers=handlers, kind=RunKind.COMPARISON)
        message = QueueMessage("run-1", RunKind.COMPARISON, "survey-1", {})

        with pytest.raises(PipelineError):
            worker.dispatch_run(message)
        worker.dispatch_run(message)  # second delivery

        stages = store.runs["run-1"]["stages"]
        assert stages["COMPATIBILITY_CHECKS:1"]["status"] == "FAILED"
        assert stages["COMPATIBILITY_CHECKS:2"]["status"] == "SUCCEEDED"


class TestInMemoryRunStore:
    def test_success_and_failure_records(self):
        store = InMemoryRunStore()
        store.create_run("run-1", RunKind.MEASUREMENT, "survey-1")
        store.start_stage("run-1", "INPUT_VALIDATION", 1)
        store.finish_stage_success("run-1", "INPUT_VALIDATION", 1, 10.5, {"count": 50})
        store.start_stage("run-1", "RECONSTRUCTION", 1)
        store.finish_stage_failure("run-1", "RECONSTRUCTION", 1, 5.0, "test error")

        run = store.runs["run-1"]
        assert run["stages"]["INPUT_VALIDATION:1"]["status"] == "SUCCEEDED"
        assert run["stages"]["INPUT_VALIDATION:1"]["metrics"]["count"] == 50
        assert run["stages"]["RECONSTRUCTION:1"]["status"] == "FAILED"
        assert run["stages"]["RECONSTRUCTION:1"]["error"] == "test error"

    def test_next_attempt_increments(self):
        store = InMemoryRunStore()
        store.create_run("run-1", RunKind.MEASUREMENT, "survey-1")
        assert store.next_attempt("run-1", "RECONSTRUCTION") == 1
        store.start_stage("run-1", "RECONSTRUCTION", 1)
        store.finish_stage_failure("run-1", "RECONSTRUCTION", 1, 1.0, "err")
        assert store.next_attempt("run-1", "RECONSTRUCTION") == 2
