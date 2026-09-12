class PipelineError(Exception):
    """Error from a pipeline stage or validation step.
    
    Args:
        user_message: Human-readable error summary for the merchant.
        transient: If True, this is an infrastructure/quota error bounded for retry.
                   If False, inputs are invalid and require revision.
    """

    def __init__(self, user_message: str, transient: bool = False) -> None:
        self.user_message = user_message
        self.transient = transient
        super().__init__(user_message)
