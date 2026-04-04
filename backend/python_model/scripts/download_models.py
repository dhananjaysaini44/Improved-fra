from __future__ import annotations

from ml_pipeline.models.nlp_model import load_nlp_model


if __name__ == "__main__":
    backend = load_nlp_model()
    print(f"NLP model backend ready: {backend}")

