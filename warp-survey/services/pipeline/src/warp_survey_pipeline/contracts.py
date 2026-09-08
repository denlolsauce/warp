import json
import logging
import os
from pathlib import Path

import jsonschema

logger = logging.getLogger(__name__)


def _schema_dir() -> Path:
    """Load schemas from WARP_SURVEY_CONTRACTS_DIR or default relative path."""
    env_dir = os.environ.get("WARP_SURVEY_CONTRACTS_DIR")
    if env_dir:
        return Path(env_dir)
    # Default: ../../../packages/contracts/schema relative to this file
    return Path(__file__).parent.parent.parent.parent / "packages" / "contracts" / "schema"


class SchemaValidator:
    """Loads and caches JSON schemas for message validation."""

    def __init__(self, schema_dir: Path | None = None):
        self.schema_dir = schema_dir or _schema_dir()
        self._schemas: dict[str, dict] = {}

    def _load_schema(self, name: str) -> dict:
        """Load schema from file, caching result."""
        if name in self._schemas:
            return self._schemas[name]

        schema_path = self.schema_dir / f"{name}.json"
        if not schema_path.exists():
            raise ValueError(f"schema not found: {schema_path}")

        with schema_path.open() as f:
            schema = json.load(f)

        self._schemas[name] = schema
        return schema

    def validate(self, name: str, payload: dict) -> None:
        """Validate payload against named schema.

        Args:
            name: Schema name (without .json extension).
            payload: Data to validate.

        Raises:
            jsonschema.ValidationError: If validation fails.
            ValueError: If schema not found.
        """
        schema = self._load_schema(name)
        jsonschema.validate(payload, schema)


# Global instance for convenience.
_default_validator = None


def _get_default_validator() -> SchemaValidator:
    global _default_validator
    if _default_validator is None:
        _default_validator = SchemaValidator()
    return _default_validator


def validate_message(name: str, payload: dict) -> None:
    """Validate a queue message payload against its schema.

    Args:
        name: Message type / schema name.
        payload: Message body.

    Raises:
        jsonschema.ValidationError: If validation fails.
        ValueError: If schema not found.
    """
    _get_default_validator().validate(name, payload)
