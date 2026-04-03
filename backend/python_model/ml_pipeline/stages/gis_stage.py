from __future__ import annotations

from typing import Any, Dict

from ml_pipeline.db import queries


def run(claim_id: int) -> Dict[str, Any]:
    parcel = queries.get_land_parcel_for_claim(claim_id)
    if not parcel:
        return {"gis_score": 1.0, "conflicts": []}

    conflicts = queries.detect_spatial_conflicts(parcel["geojson"], claim_id)
    queries.save_spatial_conflicts(claim_id, conflicts)

    if not conflicts:
        score = 1.0
    else:
        score = max(0.0, 1.0 - min(len(conflicts), 5) * 0.2)
    return {"gis_score": round(score, 4), "conflicts": conflicts}

