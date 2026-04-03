from __future__ import annotations

import json
import os
import sqlite3
from typing import Any, Dict, List, Optional

from ml_pipeline.config import config
from ml_pipeline.exceptions import ClaimNotFoundError


def _conn() -> sqlite3.Connection:
    db_path = os.path.abspath(config.SQLITE_DB_PATH)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def get_claim(claim_id: int) -> Dict[str, Any]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM claims WHERE id = ?", (claim_id,)).fetchone()
        if not row:
            raise ClaimNotFoundError(claim_id)
        return dict(row)


def get_claim_documents(claim_id: int) -> List[Dict[str, Any]]:
    claim = get_claim(claim_id)
    raw = claim.get("documents")
    if not raw:
        return []
    try:
        docs = json.loads(raw)
    except Exception:
        return []

    base = os.path.join(config.UPLOADS_BASE_PATH, "claims", str(claim_id))
    out: List[Dict[str, Any]] = []
    for item in docs:
        if isinstance(item, str):
            rel = item
        elif isinstance(item, dict):
            rel = item.get("filename") or item.get("path") or ""
        else:
            rel = ""
        if not rel:
            continue
        filename = os.path.basename(rel)
        full_path = rel if os.path.isabs(rel) else os.path.join(base, filename)
        out.append({"doc_id": filename, "storage_path": full_path, "file_type": os.path.splitext(filename)[1].lower()})
    return out


def update_pipeline_status(claim_id: int, status: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE claims SET pipeline_status = ? WHERE id = ? AND status != 'approved'",
            (status, claim_id),
        )
        conn.commit()


def save_ocr_result(claim_id: int, doc_filename: str, result: Dict[str, Any]) -> None:
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO ocr_results
            (claim_id, doc_filename, extracted_text, structured_json, accuracy, fields_complete_ratio)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                claim_id,
                doc_filename,
                result.get("raw_text"),
                json.dumps(result.get("structured_fields", {})),
                float(result.get("accuracy", 0.0)),
                float(result.get("fields_complete_ratio", 0.0)),
            ),
        )
        conn.commit()


def save_nlp_embedding(claim_id: int, embedding: List[float]) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE claims SET nlp_embedding = ? WHERE id = ? AND status != 'approved'",
            (json.dumps(embedding), claim_id),
        )
        conn.commit()


def fetch_similar_claims(embedding: List[float], top_k: int, exclude_claim_id: int) -> List[Dict[str, Any]]:
    try:
        import numpy as np
    except Exception:
        return []

    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, nlp_embedding, status
            FROM claims
            WHERE id != ?
              AND nlp_embedding IS NOT NULL
              AND status IN ('pending','approved','rejected','scored')
            """,
            (exclude_claim_id,),
        ).fetchall()

    q = np.array(embedding, dtype=float)
    out: List[Dict[str, Any]] = []
    for row in rows:
        try:
            vec = np.array(json.loads(row["nlp_embedding"]), dtype=float)
            denom = float(np.linalg.norm(q) * np.linalg.norm(vec))
            sim = float(np.dot(q, vec) / denom) if denom > 0 else 0.0
            out.append({"claim_id": int(row["id"]), "similarity_score": sim, "status": row["status"]})
        except Exception:
            continue
    out.sort(key=lambda x: x["similarity_score"], reverse=True)
    return out[:top_k]


def save_nlp_result(claim_id: int, result: Dict[str, Any]) -> None:
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO nlp_results
            (claim_id, similarity_score, is_duplicate, flagged_reason, top_matching_claim)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(claim_id) DO UPDATE SET
              similarity_score = excluded.similarity_score,
              is_duplicate = excluded.is_duplicate,
              flagged_reason = excluded.flagged_reason,
              top_matching_claim = excluded.top_matching_claim,
              processed_at = CURRENT_TIMESTAMP
            """,
            (
                claim_id,
                float(result.get("similarity_score", 0.0)),
                1 if result.get("is_duplicate") else 0,
                result.get("flagged_reason"),
                result.get("top_matching_claim_id"),
            ),
        )
        conn.commit()


def get_land_parcel_for_claim(claim_id: int) -> Optional[Dict[str, Any]]:
    claim = get_claim(claim_id)
    raw = claim.get("polygon")
    if not raw:
        return None
    try:
        geo = json.loads(raw)
    except Exception:
        return None
    return {"geojson": geo}


def detect_spatial_conflicts(geojson: Dict[str, Any], claim_id: int) -> List[Dict[str, Any]]:
    try:
        from shapely.geometry import shape
    except Exception:
        return []

    try:
        new_poly = shape(geojson)
    except Exception:
        return []

    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, polygon, status
            FROM claims
            WHERE id != ?
              AND polygon IS NOT NULL
              AND status IN ('approved','scored')
            """,
            (claim_id,),
        ).fetchall()

    out: List[Dict[str, Any]] = []
    for row in rows:
        try:
            other = shape(json.loads(row["polygon"]))
            if new_poly.intersects(other):
                overlap = float(new_poly.intersection(other).area)
                out.append(
                    {
                        "conflicting_claim_id": int(row["id"]),
                        "overlap_area": overlap,
                        "conflict_type": "EXISTING_CLAIM" if row["status"] == "approved" else "PENDING_CLAIM",
                    }
                )
        except Exception:
            continue
    return out


def save_spatial_conflicts(claim_id: int, conflicts: List[Dict[str, Any]]) -> None:
    if not conflicts:
        return
    with _conn() as conn:
        for c in conflicts:
            conn.execute(
                """
                INSERT INTO spatial_conflicts
                (claim_id, conflicting_claim_id, overlap_area, conflict_type, is_resolved)
                VALUES (?, ?, ?, ?, 0)
                """,
                (
                    claim_id,
                    c.get("conflicting_claim_id"),
                    float(c.get("overlap_area", 0.0)),
                    c.get("conflict_type", "PENDING_CLAIM"),
                ),
            )
        conn.commit()


def save_confidence_score(claim_id: int, score: Dict[str, Any]) -> None:
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO confidence_scores
            (claim_id, ocr_score, nlp_score, gis_score, overall_score, is_suspicious)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(claim_id) DO UPDATE SET
              ocr_score = excluded.ocr_score,
              nlp_score = excluded.nlp_score,
              gis_score = excluded.gis_score,
              overall_score = excluded.overall_score,
              is_suspicious = excluded.is_suspicious,
              computed_at = CURRENT_TIMESTAMP
            """,
            (
                claim_id,
                float(score.get("ocr_score", 0.0)),
                float(score.get("nlp_score", 0.0)),
                float(score.get("gis_score", 0.0)),
                float(score.get("overall_score", 0.0)),
                1 if score.get("is_suspicious") else 0,
            ),
        )
        conn.commit()


def save_land_parcel_result(claim_id: int, parcel: Dict[str, Any]) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM land_parcels WHERE claim_id = ?", (claim_id,))
        best_match = (parcel or {}).get("best_match")
        if best_match:
            conn.execute(
                """
                INSERT INTO land_parcels
                (claim_id, boundaries_geojson, area, land_cover_type, is_restricted, survey_date, reference_id, source_name, match_confidence, match_basis, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    claim_id,
                    json.dumps(best_match.get("boundaries_geojson")) if best_match.get("boundaries_geojson") is not None else None,
                    float(best_match.get("area_ha") or 0.0),
                    best_match.get("land_cover_type"),
                    1 if best_match.get("is_restricted") else 0,
                    best_match.get("survey_date"),
                    best_match.get("reference_id"),
                    best_match.get("source_name"),
                    float(best_match.get("match_confidence") or 0.0),
                    json.dumps(best_match.get("match_basis") or []),
                    json.dumps(parcel),
                ),
            )
        conn.commit()


def write_audit_log(claim_id: int, action: str, detail: Optional[Dict[str, Any]] = None) -> None:
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO system_logs (action, user_id, entity_type, entity_id, details)
            VALUES (?, NULL, 'claim', ?, ?)
            """,
            (f"ml_pipeline:{action}", claim_id, json.dumps(detail or {})),
        )
        conn.commit()
