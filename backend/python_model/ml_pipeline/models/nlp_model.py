from __future__ import annotations

import hashlib
from typing import List

from ml_pipeline.config import config

_MODEL = None
_USING_FALLBACK = False
_EMBED_DIM = 128


def _fallback_embed(text: str) -> List[float]:
    values = [0.0] * _EMBED_DIM
    for token in (text or "").lower().split():
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:2], "big") % _EMBED_DIM
        values[idx] += 1.0
    norm = sum(v * v for v in values) ** 0.5
    if norm > 0:
        values = [v / norm for v in values]
    return values


def load_nlp_model() -> str:
    global _MODEL, _USING_FALLBACK
    if _MODEL is not None or _USING_FALLBACK:
        return "fallback" if _USING_FALLBACK else "sentence-transformers"
    if config.NLP_BACKEND == "fallback":
        _MODEL = None
        _USING_FALLBACK = True
        return "fallback"
    try:
        from sentence_transformers import SentenceTransformer
        _MODEL = SentenceTransformer(config.NLP_MODEL_NAME, cache_folder=config.NLP_MODEL_CACHE_DIR)
        _USING_FALLBACK = False
        return "sentence-transformers"
    except Exception:
        _MODEL = None
        _USING_FALLBACK = True
        return "fallback"


def embed_text(text: str) -> List[float]:
    if _MODEL is None and not _USING_FALLBACK:
        load_nlp_model()
    if _MODEL is not None:
        vector = _MODEL.encode([text or ""], convert_to_numpy=True, normalize_embeddings=True)[0]
        return vector.tolist()
    return _fallback_embed(text or "")


def model_backend() -> str:
    return "fallback" if _USING_FALLBACK or _MODEL is None else "sentence-transformers"
