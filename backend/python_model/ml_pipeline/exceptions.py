from __future__ import annotations


class PipelineError(Exception):
    def __init__(self, stage: str, message: str):
        self.stage = stage
        super().__init__(message)


class ClaimNotFoundError(PipelineError):
    def __init__(self, claim_id: int):
        super().__init__("pipeline", f"Claim {claim_id} not found")

