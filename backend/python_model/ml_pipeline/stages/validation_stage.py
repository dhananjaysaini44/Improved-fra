from __future__ import annotations

from typing import Any, Dict

from ml_pipeline.db import queries


def run(claim_id: int) -> Dict[str, Any]:
    claim = queries.get_claim(claim_id)
    required = ["claimant_name", "village", "district", "state"]
    present = sum(1 for f in required if str(claim.get(f) or "").strip())
    ratio = present / len(required)
    return {
        "fields_complete_ratio": round(ratio, 4),
        "missing_fields": [f for f in required if not str(claim.get(f) or "").strip()],
    }

