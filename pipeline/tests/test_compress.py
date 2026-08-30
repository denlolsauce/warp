import logging
import shutil
from pathlib import Path

import pytest

from ply_fixtures import write_synthetic_gaussian_ply
from splat_pipeline.compress import (
    MAX_SOG_BYTES,
    MIN_SOG_BYTES,
    check_sog_size,
    resolve_splat_transform_invocation,
    run_compress,
)
from splat_pipeline.errors import PipelineError

HAS_SPLAT_TRANSFORM = shutil.which("splat-transform") is not None


def test_check_sog_size_warns_outside_range(tmp_path: Path, caplog):
    too_small = tmp_path / "small.sog"
    too_small.write_bytes(b"0" * (MIN_SOG_BYTES - 1))
    with caplog.at_level(logging.WARNING):
        check_sog_size(too_small)
    assert "outside the expected" in caplog.text


def test_check_sog_size_no_warning_inside_range(tmp_path: Path, caplog):
    ok = tmp_path / "ok.sog"
    ok.write_bytes(b"0" * (MIN_SOG_BYTES + 1024))
    with caplog.at_level(logging.WARNING):
        check_sog_size(ok)
    assert caplog.text == ""


def test_check_sog_size_returns_byte_count(tmp_path: Path):
    size = MIN_SOG_BYTES + 500
    path = tmp_path / "f.sog"
    path.write_bytes(b"0" * size)
    assert check_sog_size(path) == size


def test_run_compress_missing_cleaned_ply_raises(tmp_path: Path):
    with pytest.raises(PipelineError) as excinfo:
        run_compress(tmp_path)
    assert excinfo.value.stage == "compress"
    assert "cleanup" in excinfo.value.message


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_resolve_splat_transform_invocation_against_real_cli():
    resolve_splat_transform_invocation()  # must not raise


@pytest.mark.skipif(not HAS_SPLAT_TRANSFORM, reason="splat-transform not installed")
def test_run_compress_real_conversion(tmp_path: Path):
    write_synthetic_gaussian_ply(tmp_path / "cleaned.ply", n=200)

    sog_path = run_compress(tmp_path)

    assert sog_path == tmp_path / "compressed" / "model.sog"
    assert sog_path.is_file()
    assert sog_path.stat().st_size > 0
