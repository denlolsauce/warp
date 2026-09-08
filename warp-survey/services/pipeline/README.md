# warp-survey-pipeline

Survey → measurement and visualization processing pipeline.

This is a production-quality Python package skeleton for a multi-stage, distributed job processor. It provides:

- **Contracts**: JSON schema validation for queue messages (language-neutral).
- **Queue**: Reliable Redis claiming via LMOVE with lease/heartbeat/reaper pattern (no BullMQ).
- **Backends**: Abstract interface for photogrammetry (OpenDroneMap, others); pure-function config builders and output mapping; container execution stubs.
- **Coords**: Affine transform helpers for survey coordinates (translation, scale, rotation, composition, inversion).
- **Worker**: Orchestration skeleton (claim → validate → dispatch → stages); structured logging (JSON lines).
- **Errors**: User-facing error reporting with transient/permanent distinction.

## Layout

```
warp-survey/services/pipeline/
├── src/warp_survey_pipeline/
│   ├── __init__.py
│   ├── contracts.py          # Schema validation
│   ├── queue.py              # Redis claiming (claim/heartbeat/reap/fencing)
│   ├── coords.py             # Coordinate transforms
│   ├── errors.py             # Error types
│   ├── worker.py             # Orchestration skeleton
│   └── backends/
│       ├── base.py           # PhotogrammetryBackend ABC
│       ├── odm.py            # OpenDroneMap backend (stubs)
│       └── __init__.py
└── tests/
    ├── test_queue.py         # Queue claiming, leasing
    ├── test_coords.py        # Coordinate transforms
    ├── test_contracts.py     # Schema validation
    ├── test_backends.py      # Backend interface, ODM mapping
    └── test_worker.py        # Worker dispatch, stage lifecycle
```

## Running tests

```bash
# From this directory, with uv installed
uv venv
uv pip install -e '.[dev]'
uv run pytest -q
```

All tests pass without external dependencies (in-memory fakes for Redis, temp fixtures for file I/O).

## What's stubbed and when it's implemented

| Component | Status | Phase |
|-----------|--------|-------|
| Queue claiming, leasing, reaping | ✓ Tested | Foundation |
| Coordinate transforms (affine-only) | ✓ Tested | Foundation |
| Schema validation (jsonschema) | ✓ Tested | Foundation |
| ODM backend: config → CLI args | ✓ Tested | Foundation |
| ODM backend: output mapping | ✓ Tested | Foundation |
| Worker dispatch, stage lifecycle | ✓ Stubbed | Foundation |
| **Stage execution (INGEST, MEASUREMENT, VISUALIZATION, COMPARISON)** | NotImplementedError | Technical validation |
| **Container invocation** | NotImplementedError | Technical validation |
| **Database persistence** | Protocol only | Operational readiness |
| **Heartbeat thread** | Stub | Operational readiness |

## Design notes

**Checkpoints are held out.** Independent validation points are never passed to the reconstruction backend. They are used for post-job QA only.

**No pyproj yet.** Coordinate transforms are affine-only (float64). Projected ↔ geographic transforms arrive precomputed from GDAL/PROJ containers.

**Language-neutral queue.** Messages are JSON; the schema lives in `packages/contracts/schema/` and is validated independently of Python/Node versions.

**Fencing on concurrent writes.** Redis INCR gives each worker a monotonically increasing fence token per run, so stale workers can be rejected at DB write time.

**Structured logging.** Events are JSON lines (run_id, stage, attempt, elapsed_s, status, error). Timestamps are ISO 8601 UTC.

**Transient vs. permanent errors.** Pipeline errors distinguish infrastructure failures (bounded retry) from data-quality failures (require revised inputs) for upstream decision-making.
