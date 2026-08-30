class PipelineError(Exception):
    def __init__(self, stage: str, message: str, stderr_tail: str = "") -> None:
        self.stage = stage
        self.message = message
        self.stderr_tail = stderr_tail
        super().__init__(self._format())

    def _format(self) -> str:
        if self.stderr_tail:
            return f"[{self.stage}] {self.message}\n{self.stderr_tail}"
        return f"[{self.stage}] {self.message}"
