from __future__ import annotations

import os


def _get(key: str, default: str) -> str:
    return os.getenv(key, default)


class PipelineConfig:
    NLP_MODEL_NAME = _get("NLP_MODEL_NAME", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    NLP_MODEL_CACHE_DIR = _get("NLP_MODEL_CACHE_DIR", "./models/nlp")
    NLP_SIMILARITY_THRESHOLD = float(_get("NLP_SIMILARITY_THRESHOLD", "0.85"))
    NLP_TOP_K = int(_get("NLP_TOP_K_COMPARISONS", "10"))

    OCR_WEIGHT = float(_get("OCR_CONFIDENCE_WEIGHT", "0.30"))
    NLP_WEIGHT = float(_get("NLP_CONFIDENCE_WEIGHT", "0.40"))
    GIS_WEIGHT = float(_get("GIS_CONFIDENCE_WEIGHT", "0.30"))
    SUSPICIOUS_THRESHOLD = float(_get("SUSPICIOUS_SCORE_THRESHOLD", "0.60"))

    TIMEOUT_SECONDS = int(_get("PIPELINE_TIMEOUT_SECONDS", "60"))
    SQLITE_DB_PATH = _get("SQLITE_DB_PATH", "./fra_atlas.db")
    UPLOADS_BASE_PATH = _get("UPLOADS_BASE_PATH", "./uploads")


config = PipelineConfig()

