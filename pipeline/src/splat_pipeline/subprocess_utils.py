import logging
import shutil
import subprocess

from .errors import PipelineError

logger = logging.getLogger(__name__)

STDERR_TAIL_LINES = 40


def resolve_executable(cmd: list[str]) -> list[str]:
    # Windows' CreateProcess (unlike a shell) does not apply PATHEXT resolution to a
    # bare command name, so npm-installed .cmd shims (e.g. splat-transform) are
    # otherwise "not found" even though they're on PATH. shutil.which does the same
    # PATHEXT search a shell would, and is a harmless no-op resolution on POSIX.
    resolved = shutil.which(cmd[0])
    return [resolved, *cmd[1:]] if resolved else cmd


def _failure_error(stage: str, cmd: list[str], returncode: int, stderr_text: str) -> PipelineError:
    tail = "\n".join(stderr_text.splitlines()[-STDERR_TAIL_LINES:])
    return PipelineError(
        stage,
        f"command exited with code {returncode}: {' '.join(cmd)}",
        tail,
    )


def run_command(stage: str, cmd: list[str]) -> None:
    logger.info("[%s] %s", stage, " ".join(cmd))
    try:
        result = subprocess.run(
            resolve_executable(cmd), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
    except FileNotFoundError as error:
        raise PipelineError(stage, f"executable not found: {cmd[0]} ({error})") from error

    if result.returncode != 0:
        raise _failure_error(stage, cmd, result.returncode, result.stderr)
