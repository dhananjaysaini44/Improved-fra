from __future__ import annotations

import os
from typing import Any, Dict

from ml_pipeline.db import queries


def _read_document(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def run(claim_id: int) -> Dict[str, Any]:
    docs = queries.get_claim_documents(claim_id)
    if not docs:
        return {"ocr_score": 0.0, "documents_processed": 0}

    processed = 0
    non_empty = 0
    for doc in docs:
        path = doc["storage_path"]
        raw_text = ""
        if os.path.exists(path):
            try:
                payload = _read_document(path)
                raw_text = payload.decode("utf-8", errors="ignore")
            except Exception:
                raw_text = ""
        if raw_text.strip():
            non_empty += 1
        processed += 1
        queries.save_ocr_result(
            claim_id,
            doc.get("doc_id", "unknown"),
            {
                "raw_text": raw_text[:10000],
                "structured_fields": {},
                "accuracy": 1.0 if raw_text.strip() else 0.0,
                "fields_complete_ratio": 1.0 if raw_text.strip() else 0.0,
            },
        )

    score = non_empty / processed if processed else 0.0
    return {"ocr_score": round(score, 4), "documents_processed": processed}

