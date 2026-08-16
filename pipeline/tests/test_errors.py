from portal_pipeline.errors import PipelineError


def test_carries_stage_and_message():
    error = PipelineError("extract", "something broke")
    assert error.stage == "extract"
    assert error.message == "something broke"
    assert error.stderr_tail == ""
    assert str(error) == "[extract] something broke"


def test_includes_stderr_tail_when_present():
    error = PipelineError("sfm:glomap_mapper", "command failed", "line1\nline2")
    assert error.stderr_tail == "line1\nline2"
    assert str(error) == "[sfm:glomap_mapper] command failed\nline1\nline2"
