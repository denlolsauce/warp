"""Tests for pipeline worker orchestration."""

import json

import pytest

from warp_survey_pipeline.errors import PipelineError
from warp_survey_pipeline.worker import (
    InMemoryRunStore,
    PipelineWorker,
    QueueMessage,
    RunKind,
)


class TestPipelineWorker:
    @pytest.fixture
    def store(self):
        return InMemoryRunStore()

    @pytest.fixture
    def worker(self, store):
        return PipelineWorker(store)

    def test_parse_message_valid(self, worker):
        """Test parsing a valid queue message."""
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

    def test_parse_message_malformed_json(self, worker):
        """Test parsing fails on invalid JSON."""
        raw = "not json"

        with pytest.raises(PipelineError, match="malformed"):
            worker.parse_message(raw)

    def test_parse_message_missing_run_id(self, worker):
        """Test parsing fails if runId is missing."""
        raw = json.dumps({"runKind": "MEASUREMENT", "surveyId": "survey-456"})

        with pytest.raises(PipelineError, match="required fields"):
            worker.parse_message(raw)

    def test_parse_message_missing_run_kind(self, worker):
        """Test parsing fails if runKind is missing."""
        raw = json.dumps({"runId": "run-123", "surveyId": "survey-456"})

        with pytest.raises(PipelineError, match="required fields"):
            worker.parse_message(raw)

    def test_parse_message_missing_survey_id(self, worker):
        """Test parsing fails if surveyId is missing."""
        raw = json.dumps({"runId": "run-123", "runKind": "MEASUREMENT"})

        with pytest.raises(PipelineError, match="required fields"):
            worker.parse_message(raw)

    def test_parse_message_invalid_run_kind(self, worker):
        """Test parsing fails on invalid runKind."""
        raw = json.dumps(
            {
                "runId": "run-123",
                "runKind": "INVALID_KIND",
                "surveyId": "survey-456",
            }
        )

        with pytest.raises(PipelineError, match="invalid runKind"):
            worker.parse_message(raw)

    def test_dispatch_measurement_run(self, worker, store):
        """Test dispatching a MEASUREMENT run."""
        message = QueueMessage(
            run_id="run-1",
            run_kind=RunKind.MEASUREMENT,
            survey_id="survey-1",
            payload={},
        )

        with pytest.raises(NotImplementedError, match="technical-validation"):
            worker.dispatch_run(message)

        # Run should be created even though stage fails
        assert "run-1" in store.runs

    def test_dispatch_visualization_run(self, worker, store):
        """Test dispatching a VISUALIZATION run."""
        message = QueueMessage(
            run_id="run-2",
            run_kind=RunKind.VISUALIZATION,
            survey_id="survey-2",
            payload={},
        )

        with pytest.raises(NotImplementedError, match="technical-validation"):
            worker.dispatch_run(message)

        assert "run-2" in store.runs

    def test_dispatch_comparison_run(self, worker, store):
        """Test dispatching a COMPARISON run."""
        message = QueueMessage(
            run_id="run-3",
            run_kind=RunKind.COMPARISON,
            survey_id="survey-3",
            payload={},
        )

        with pytest.raises(NotImplementedError, match="technical-validation"):
            worker.dispatch_run(message)

        assert "run-3" in store.runs

    def test_in_memory_store(self):
        """Test in-memory run store."""
        store = InMemoryRunStore()

        store.create_run("run-1", RunKind.MEASUREMENT, "survey-1")
        assert "run-1" in store.runs

        store.start_stage("run-1", "INGEST", 1)
        store.finish_stage_success("run-1", "INGEST", 1, 10.5, {"count": 50})

        run = store.runs["run-1"]
        stage_key = "INGEST:1"
        assert run["stages"][stage_key]["status"] == "SUCCEEDED"
        assert run["stages"][stage_key]["elapsed_s"] == 10.5
        assert run["stages"][stage_key]["metrics"]["count"] == 50

    def test_in_memory_store_stage_failure(self):
        """Test in-memory store recording stage failure."""
        store = InMemoryRunStore()

        store.create_run("run-1", RunKind.MEASUREMENT, "survey-1")
        store.start_stage("run-1", "MEASUREMENT", 1)
        store.finish_stage_failure("run-1", "MEASUREMENT", 1, 5.0, "test error")

        run = store.runs["run-1"]
        stage_key = "MEASUREMENT:1"
        assert run["stages"][stage_key]["status"] == "FAILED"
        assert run["stages"][stage_key]["error"] == "test error"
