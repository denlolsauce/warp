import sys

import pytest

from portal_pipeline.errors import PipelineError
from portal_pipeline.subprocess_utils import STDERR_TAIL_LINES, run_command


def test_missing_executable_raises_pipeline_error():
    with pytest.raises(PipelineError) as excinfo:
        run_command("test:missing", ["definitely-not-a-real-binary-xyz"])
    assert excinfo.value.stage == "test:missing"


def test_nonzero_exit_captures_stderr_tail():
    script = "import sys\nfor i in range(50): print(f'err{i}', file=sys.stderr)\nsys.exit(1)"
    with pytest.raises(PipelineError) as excinfo:
        run_command("test:fail", [sys.executable, "-c", script])

    error = excinfo.value
    assert error.stage == "test:fail"
    tail_lines = error.stderr_tail.splitlines()
    assert len(tail_lines) == STDERR_TAIL_LINES
    assert tail_lines[0] == "err10"
    assert tail_lines[-1] == "err49"


def test_success_does_not_raise():
    run_command("test:ok", [sys.executable, "-c", "print('fine')"])
