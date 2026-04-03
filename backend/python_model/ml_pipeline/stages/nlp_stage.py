from __future__ import annotations

from typing import Any, Dict

from ml_pipeline.config import config
from ml_pipeline.db import queries
from ml_pipeline.models.nlp_model import embed_text, model_backend


def run(claim_id: int) -> Dict[str, Any]:
    claim = queries.get_claim(claim_id)
    text = " ".join(
        str(claim.get(k) or "")
        for k in ["claimant_name", "village", "district", "state", "polygon", "documents"]
    ).strip()
    embedding = embed_text(text)
    queries.save_nlp_embedding(claim_id, embedding)

    similar = queries.fetch_similar_claims(embedding, config.NLP_TOP_K, claim_id)
    top = similar[0] if similar else {"similarity_score": 0.0, "claim_id": None}
    score = float(top.get("similarity_score", 0.0))
    is_dup = score >= config.NLP_SIMILARITY_THRESHOLD

    result = {
        "similarity_score": round(score, 4),
        "is_duplicate": is_dup,
        "flagged_reason": "Similarity threshold exceeded" if is_dup else None,
        "top_matching_claim_id": top.get("claim_id"),
        "model_backend": model_backend(),
    }
    queries.save_nlp_result(claim_id, result)
    return result

