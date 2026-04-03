from __future__ import annotations

import math
from typing import Any, Dict

from ml_pipeline.config import config
from ml_pipeline.db import queries
from ml_pipeline.exceptions import PipelineError
from ml_pipeline.models.nlp_model import embed_text, model_backend
from ml_pipeline.stages import gis_stage, nlp_stage, ocr_stage, validation_stage


def _weighted_score(ocr_score: float, nlp_score: float, gis_score: float) -> float:
    total = (ocr_score * config.OCR_WEIGHT) + (nlp_score * config.NLP_WEIGHT) + (gis_score * config.GIS_WEIGHT)
    return max(0.0, min(1.0, total))


class MLPipeline:
    @staticmethod
    def run(claim_id: int) -> Dict[str, Any]:
        try:
            queries.update_pipeline_status(claim_id, "OCR_PROCESSING")
            ocr = ocr_stage.run(claim_id)

            queries.update_pipeline_status(claim_id, "VALIDATING")
            val = validation_stage.run(claim_id)

            queries.update_pipeline_status(claim_id, "NLP_PROCESSING")
            nlp = nlp_stage.run(claim_id)

            queries.update_pipeline_status(claim_id, "GIS_PROCESSING")
            gis = gis_stage.run(claim_id)

            queries.update_pipeline_status(claim_id, "SCORING")
            overall = _weighted_score(
                float(ocr.get("ocr_score", 0.0)),
                float(nlp.get("similarity_score", 0.0)),
                float(gis.get("gis_score", 1.0)),
            )
            score = {
                "ocr_score": float(ocr.get("ocr_score", 0.0)),
                "nlp_score": float(nlp.get("similarity_score", 0.0)),
                "gis_score": float(gis.get("gis_score", 1.0)),
                "overall_score": round(overall, 4),
                "is_suspicious": overall >= config.SUSPICIOUS_THRESHOLD,
            }
            queries.save_confidence_score(claim_id, score)
            queries.update_pipeline_status(claim_id, "SCORED")
            queries.write_audit_log(claim_id, "completed", score)

            return {
                "pipeline_status": "SCORED",
                "ocr": ocr,
                "validation": val,
                "nlp": nlp,
                "gis": gis,
                "score": score,
            }
        except Exception as exc:
            queries.update_pipeline_status(claim_id, "PIPELINE_ERROR")
            queries.write_audit_log(claim_id, "error", {"error": str(exc)})
            if isinstance(exc, PipelineError):
                raise
            raise PipelineError("pipeline", str(exc)) from exc

    @staticmethod
    def run_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        claim = payload.get("claim") or {}
        existing = payload.get("existing_claims") or payload.get("existingClaims") or []
        model_result = payload.get("model_result") or {}
        required_fields = ["claimant_name", "village", "district", "state"]
        present_required = sum(1 for field in required_fields if str(claim.get(field) or "").strip())
        validation = {
            "fields_complete_ratio": round(present_required / len(required_fields), 4),
            "missing_fields": [field for field in required_fields if not str(claim.get(field) or "").strip()],
        }

        ocr_score = float(
            (model_result.get("extraction_confidence") or {}).get("overall", 0.0)
            if isinstance(model_result, dict)
            else 0.0
        )

        claim_text = " ".join(
            str(claim.get(k) or "")
            for k in ["claimant_name", "village", "district", "state"]
        )
        ocr_text = str(model_result.get("ocr_text") or "") if isinstance(model_result, dict) else ""
        embedding = embed_text(f"{claim_text} {ocr_text}".strip())

        def cosine(a: list[float], b: list[float]) -> float:
            dot = sum(x * y for x, y in zip(a, b))
            na = math.sqrt(sum(x * x for x in a))
            nb = math.sqrt(sum(y * y for y in b))
            return dot / (na * nb) if na > 0 and nb > 0 else 0.0

        best_sim = 0.0
        best_claim_id = None
        for item in existing:
            text = " ".join(str(item.get(k) or "") for k in ["claimant_name", "village", "district", "state"])
            vec = embed_text(text)
            sim = cosine(embedding, vec)
            if sim > best_sim:
                best_sim = sim
                best_claim_id = item.get("id")

        nlp_result = {
            "similarity_score": round(best_sim, 4),
            "is_duplicate": best_sim >= config.NLP_SIMILARITY_THRESHOLD,
            "flagged_reason": "Similarity threshold exceeded" if best_sim >= config.NLP_SIMILARITY_THRESHOLD else None,
            "top_matching_claim_id": best_claim_id,
            "model_backend": model_backend(),
        }

        gis_score = 1.0
        conflicts = []
        try:
            from shapely.geometry import shape
            poly = claim.get("polygon")
            if isinstance(poly, str):
                import json
                poly = json.loads(poly)
            if poly:
                a = shape(poly)
                overlaps = 0
                for item in existing:
                    other = item.get("polygon")
                    if isinstance(other, str):
                        import json
                        other = json.loads(other)
                    if not other:
                        continue
                    b = shape(other)
                    if a.intersects(b):
                        overlaps += 1
                        overlap_area = 0.0
                        try:
                            overlap_area = float(a.intersection(b).area)
                        except Exception:
                            overlap_area = 0.0
                        conflicts.append(
                            {
                                "conflicting_claim_id": item.get("id"),
                                "overlap_area": round(overlap_area, 4),
                                "conflict_type": "EXISTING_CLAIM" if item.get("status") == "approved" else "PENDING_CLAIM",
                            }
                        )
                gis_score = max(0.0, 1.0 - min(overlaps, 5) * 0.2)
        except Exception:
            gis_score = 1.0
            conflicts = []

        gis_result = {
            "gis_score": round(gis_score, 4),
            "conflicts": conflicts,
        }

        overall = _weighted_score(ocr_score, nlp_result["similarity_score"], gis_score)
        score = {
            "ocr_score": round(ocr_score, 4),
            "nlp_score": round(nlp_result["similarity_score"], 4),
            "gis_score": round(gis_score, 4),
            "overall_score": round(overall, 4),
            "is_suspicious": overall >= config.SUSPICIOUS_THRESHOLD,
        }

        return {
            "pipeline_status": "SCORED",
            "mode": "payload",
            "validation": validation,
            "nlp": nlp_result,
            "gis": gis_result,
            "score": score,
        }
