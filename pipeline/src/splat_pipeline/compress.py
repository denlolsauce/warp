import logging
import subprocess
from pathlib import Path

from .errors import PipelineError
from .subprocess_utils import resolve_executable, run_command

logger = logging.getLogger(__name__)

# CLAUDE.md: "target delivered asset size: 4-20MB".
MIN_SOG_BYTES = 4 * 1024 * 1024
MAX_SOG_BYTES = 20 * 1024 * 1024
REQUIRED_HELP_MARKERS = ["--overwrite", ".ply", ".sog"]


def resolve_splat_transform_invocation() -> None:
    try:
        result = subprocess.run(
            resolve_executable(["splat-transform", "--help"]),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as error:
        raise PipelineError(
            "compress:splat-transform", f"executable not found: splat-transform ({error})"
        ) from error

    help_text = result.stdout + result.stderr
    missing = [marker for marker in REQUIRED_HELP_MARKERS if marker not in help_text]
    if missing:
        raise PipelineError(
            "compress:splat-transform",
            f"splat-transform --help is missing expected marker(s) {missing}; "
            "its CLI surface may have changed since this pipeline was written",
        )


def check_sog_size(sog_path: Path) -> int:
    size = sog_path.stat().st_size
    if not (MIN_SOG_BYTES <= size <= MAX_SOG_BYTES):
        logger.warning(
            "SOG is %.1f MB, outside the expected %.0f-%.0f MB range",
            size / (1024 * 1024), MIN_SOG_BYTES / (1024 * 1024), MAX_SOG_BYTES / (1024 * 1024),
        )
    return size


def run_compress(workdir: Path) -> Path:
    cleaned_path = workdir / "cleaned.ply"
    sog_path = workdir / "compressed" / "model.sog"

    if not cleaned_path.is_file():
        raise PipelineError("compress", f"cleaned PLY not found: {cleaned_path} — run `cleanup` first")

    resolve_splat_transform_invocation()
    sog_path.parent.mkdir(parents=True, exist_ok=True)
    run_command("compress:splat-transform", ["splat-transform", "-w", str(cleaned_path), str(sog_path)])

    size = check_sog_size(sog_path)
    logger.info("compress: %s (%.1f MB)", sog_path.name, size / (1024 * 1024))
    return sog_path
