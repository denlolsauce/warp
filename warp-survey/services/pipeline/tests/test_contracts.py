"""Tests for schema validation."""

import json
import tempfile
from pathlib import Path

import jsonschema
import pytest

from warp_survey_pipeline.contracts import SchemaValidator, validate_message


class TestSchemaValidator:
    def test_load_schema_from_file(self):
        """Test loading schema from filesystem."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            schema = {
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            }
            (schema_dir / "test_message.json").write_text(json.dumps(schema))

            validator = SchemaValidator(schema_dir)
            validator.validate("test_message", {"name": "Alice"})

    def test_validate_success(self):
        """Test successful validation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            schema = {
                "type": "object",
                "properties": {"runId": {"type": "string"}, "data": {"type": "string"}},
                "required": ["runId"],
            }
            (schema_dir / "job_message.json").write_text(json.dumps(schema))

            validator = SchemaValidator(schema_dir)
            validator.validate("job_message", {"runId": "run-1", "data": "test"})

    def test_validate_failure_missing_required(self):
        """Test validation failure on missing required field."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            schema = {
                "type": "object",
                "properties": {"runId": {"type": "string"}},
                "required": ["runId"],
            }
            (schema_dir / "job_message.json").write_text(json.dumps(schema))

            validator = SchemaValidator(schema_dir)
            with pytest.raises(jsonschema.ValidationError):
                validator.validate("job_message", {})

    def test_validate_failure_wrong_type(self):
        """Test validation failure on type mismatch."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            schema = {
                "type": "object",
                "properties": {"runId": {"type": "string"}},
                "required": ["runId"],
            }
            (schema_dir / "job_message.json").write_text(json.dumps(schema))

            validator = SchemaValidator(schema_dir)
            with pytest.raises(jsonschema.ValidationError):
                validator.validate("job_message", {"runId": 123})

    def test_schema_not_found(self):
        """Test error when schema doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            validator = SchemaValidator(schema_dir)

            with pytest.raises(ValueError, match="schema not found"):
                validator.validate("nonexistent", {})

    def test_schema_caching(self):
        """Test that schemas are cached."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            schema = {"type": "object"}
            schema_file = schema_dir / "cached.json"
            schema_file.write_text(json.dumps(schema))

            validator = SchemaValidator(schema_dir)
            validator.validate("cached", {})

            # Delete file and validate again (should work from cache)
            schema_file.unlink()
            validator.validate("cached", {})


class TestMessageValidation:
    def test_validate_message_function(self):
        """Test top-level validate_message function."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_dir = Path(tmpdir)
            schema = {
                "type": "object",
                "properties": {"runId": {"type": "string"}},
                "required": ["runId"],
            }
            (schema_dir / "job.json").write_text(json.dumps(schema))

            # Inject test schema dir
            import warp_survey_pipeline.contracts

            original = warp_survey_pipeline.contracts._default_validator
            warp_survey_pipeline.contracts._default_validator = SchemaValidator(schema_dir)

            try:
                validate_message("job", {"runId": "test"})
            finally:
                warp_survey_pipeline.contracts._default_validator = original
