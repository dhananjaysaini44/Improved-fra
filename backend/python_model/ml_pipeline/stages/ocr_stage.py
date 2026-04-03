from __future__ import annotations

import os
import tarfile
from typing import Any, Dict

from ml_pipeline.db import queries


def _read_document(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _read_archive_documents(path: str) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            extracted = archive.extractfile(member)
            if extracted is None:
                continue
            out.append((member.name, extracted.read()))
    return out


def run(claim_id: int) -> Dict[str, Any]:
    docs = queries.get_claim_documents(claim_id)
    if not docs:
        return {"ocr_score": 0.0, "documents_processed": 0}

    processed = 0
    non_empty = 0
    for doc in docs:
        path = doc["storage_path"]
        payloads: list[tuple[str, bytes]] = []
        if os.path.exists(path):
            try:
                if path.endswith(".tar.gz") or path.endswith(".tgz"):
                    payloads = _read_archive_documents(path)
                else:
                    payloads = [(doc.get("doc_id", "unknown"), _read_document(path))]
            except Exception:
                payloads = []

        if not payloads:
            payloads = [(doc.get("doc_id", "unknown"), b"")]

        for doc_name, payload in payloads:
            raw_text = payload.decode("utf-8", errors="ignore")
            if raw_text.strip():
                non_empty += 1
            processed += 1
            queries.save_ocr_result(
                claim_id,
                doc_name,
                {
                    "raw_text": raw_text[:10000],
                    "structured_fields": {},
                    "accuracy": 1.0 if raw_text.strip() else 0.0,
                    "fields_complete_ratio": 1.0 if raw_text.strip() else 0.0,
                },
            )

    score = non_empty / processed if processed else 0.0
    return {"ocr_score": round(score, 4), "documents_processed": processed}
