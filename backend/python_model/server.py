from __future__ import annotations

from datetime import datetime, timezone
from difflib import SequenceMatcher
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import io
import json
import os
import re
import shutil
import sqlite3
import tempfile
import importlib

from ml_pipeline.exceptions import PipelineError
from ml_pipeline.models.nlp_model import load_nlp_model
from ml_pipeline.pipeline import MLPipeline


APP_DIR = Path(__file__).resolve().parent
ARTIFACTS_DIR = APP_DIR / "artifacts"
DEFAULT_DB_PATH = APP_DIR.parent / "fra_atlas.db"
ARTIFACTS_DIR.mkdir(exist_ok=True)

FIELD_PATTERNS = {
    "claimant_name": [
        r"Name of Claimant\s*[:\-]\s*(.+)",
        r"Claimant Name\s*[:\-]\s*(.+)",
        r"Name\s*[:\-]\s*(.+)",
    ],
    "father_mother_name": [
        r"Father(?:'s|/Mother's)? Name\s*[:\-]\s*(.+)",
        r"Mother(?:'s)? Name\s*[:\-]\s*(.+)",
    ],
    "spouse_name": [
        r"Spouse(?:'s)? Name\s*[:\-]\s*(.+)",
        r"Husband(?:'s)? Name\s*[:\-]\s*(.+)",
        r"Wife(?:'s)? Name\s*[:\-]\s*(.+)",
    ],
    "village": [
        r"Village\s*[:\-]\s*(.+)",
    ],
    "gram_panchayat": [
        r"Gram Panchayat\s*[:\-]\s*(.+)",
    ],
    "tehsil_taluka": [
        r"Tehsil/Taluka\s*[:\-]\s*(.+)",
        r"Tehsil\s*[:\-]\s*(.+)",
        r"Taluka\s*[:\-]\s*(.+)",
    ],
    "district": [
        r"District\s*[:\-]\s*(.+)",
    ],
    "state": [
        r"State\s*[:\-]\s*(.+)",
    ],
    "aadhaar_number": [
        r"Aadhaar(?: Card)? No\.?\s*[:\-]\s*([0-9Xx\-\s]{8,20})",
        r"Aadhaar\s*[:\-]\s*([0-9Xx\-\s]{8,20})",
    ],
    "type_of_right": [
        r"Type of Right Claimed\s*[:\-]\s*(.+)",
        r"Type of Right\s*[:\-]\s*(.+)",
    ],
    "purpose_of_land_use": [
        r"Purpose of Land Use\s*[:\-]\s*(.+)",
    ],
    "extent_of_land": [
        r"Extent of Land\s*[:\-]\s*(.+)",
        r"Land Area\s*[:\-]\s*(.+)",
    ],
    "attached_map": [
        r"Attached Map\s*[:\-]\s*(.+)",
    ],
    "supporting_evidence": [
        r"Supporting Evidence(?: of Occupation)?\s*[:\-]\s*(.+)",
    ],
}

LOCATION_BOUNDARY_PATTERNS = [
    r"Description of Location and Boundaries\s*[:\-]\s*(.+?)(?:\n\s*\d+\.\s|\Z)",
    r"Location and Boundaries\s*[:\-]\s*(.+?)(?:\n\s*\d+\.\s|\Z)",
]


app = FastAPI(title="FRA OCR and Duplicate Detection API", version="2.0.0")

TESSERACT_CMD = os.getenv("TESSERACT_CMD", "").strip()
TESSERACT_LANG = os.getenv("TESSERACT_LANG", "eng").strip() or "eng"
TESSERACT_PSM = os.getenv("TESSERACT_PSM", "6").strip() or "6"
TESSERACT_OEM = os.getenv("TESSERACT_OEM", "3").strip() or "3"

_OPTIONAL_IMPORTS: Dict[str, Any] = {}


def _load_optional(module_name: str, attr: Optional[str] = None) -> Any:
    key = f"{module_name}:{attr or ''}"
    if key in _OPTIONAL_IMPORTS:
        return _OPTIONAL_IMPORTS[key]
    try:
        module = importlib.import_module(module_name)
        value = getattr(module, attr) if attr else module
    except Exception:
        value = None
    _OPTIONAL_IMPORTS[key] = value
    return value


def pil_image_module() -> Any:
    return _load_optional("PIL.Image")


def cv2_module() -> Any:
    return _load_optional("cv2")


def numpy_module() -> Any:
    return _load_optional("numpy")


def pytesseract_module() -> Any:
    module = _load_optional("pytesseract")
    if module is not None and TESSERACT_CMD:
        try:
            module.pytesseract.tesseract_cmd = TESSERACT_CMD
        except Exception:
            pass
    return module


def convert_from_path_fn() -> Any:
    return _load_optional("pdf2image", "convert_from_path")


def pdf_reader_cls() -> Any:
    return _load_optional("pypdf", "PdfReader")


class PipelineRequest(BaseModel):
    claim_id: Optional[int] = None
    claim: Optional[Dict[str, Any]] = None
    existing_claims: Optional[List[Dict[str, Any]]] = None
    model_result: Optional[Dict[str, Any]] = None


@app.on_event("startup")
async def startup_event() -> None:
    # Preload embedding backend. Falls back gracefully if transformer model isn't available.
    load_nlp_model()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sanitize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def normalize_text(value: Optional[str]) -> str:
    value = sanitize_text(value).lower()
    value = re.sub(r"\b(s/o|d/o|w/o)\b", " ", value)
    value = re.sub(r"\bmr\b|\bmrs\b|\bms\b|\bshri\b|\bsmt\b", " ", value)
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def tokens(value: Optional[str]) -> set[str]:
    return {token for token in normalize_text(value).split() if token}


def safe_json_loads(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def try_decode_bytes(payload: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return ""


def tesseract_runtime_available() -> bool:
    pytesseract = pytesseract_module()
    if pytesseract is None:
        return False
    explicit = getattr(pytesseract.pytesseract, "tesseract_cmd", "") or ""
    if explicit and Path(explicit).exists():
        return True
    return shutil.which("tesseract") is not None


def build_tesseract_config() -> str:
    return f"--oem {TESSERACT_OEM} --psm {TESSERACT_PSM}"


def extract_pdf_text_fallback(payload: bytes) -> str:
    decoded = payload.decode("latin-1", errors="ignore")
    matches = re.findall(r"\(([^()]*)\)", decoded)
    text = " ".join(matches)
    text = re.sub(r"\\[nrt]", " ", text)
    text = re.sub(r"\\([()\\])", r"\1", text)
    return sanitize_text(text)


def extract_pdf_text_with_reader(payload: bytes) -> str:
    PdfReader = pdf_reader_cls()
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(io.BytesIO(payload))
        parts = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                parts.append(page_text)
        return sanitize_text("\n".join(parts))
    except Exception:
        return ""


def preprocess_image_bytes(payload: bytes) -> Optional["np.ndarray"]:
    Image = pil_image_module()
    cv2 = cv2_module()
    np = numpy_module()
    if Image is None or cv2 is None or np is None:
        return None
    try:
        image = Image.open(io.BytesIO(payload)).convert("RGB")
        image_np = np.array(image)
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)
        denoised = cv2.fastNlMeansDenoising(gray)
        thresh = cv2.adaptiveThreshold(
            denoised,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            11,
        )
        kernel = np.ones((1, 1), np.uint8)
        morph = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        return morph
    except Exception:
        return None


def run_ocr_on_image(payload: bytes) -> Tuple[str, Dict[str, Any]]:
    Image = pil_image_module()
    cv2 = cv2_module()
    np = numpy_module()
    pytesseract = pytesseract_module()
    dependency_status = {
        "pillow": Image is not None,
        "opencv": cv2 is not None,
        "numpy": np is not None,
        "pytesseract": pytesseract is not None,
        "tesseract_binary": tesseract_runtime_available(),
    }
    if not all(dependency_status.values()):
        return "", {
            "method": "unavailable",
            "dependency_status": dependency_status,
            "message": "OCR dependencies are not fully installed.",
        }

    processed = preprocess_image_bytes(payload)
    if processed is None:
        return "", {
            "method": "failed",
            "dependency_status": dependency_status,
            "message": "Image preprocessing failed.",
        }

    try:
        image = Image.fromarray(processed)
        text = pytesseract.image_to_string(
            image,
            lang=TESSERACT_LANG,
            config=build_tesseract_config(),
        )
        return sanitize_text(text), {
            "method": "tesseract_image",
            "dependency_status": dependency_status,
            "message": "OCR completed on image content.",
        }
    except Exception as exc:
        return "", {
            "method": "failed",
            "dependency_status": dependency_status,
            "message": f"OCR failed: {exc}",
        }


def run_ocr_on_pdf(payload: bytes) -> Tuple[str, Dict[str, Any]]:
    PdfReader = pdf_reader_cls()
    convert_from_path = convert_from_path_fn()
    Image = pil_image_module()
    cv2 = cv2_module()
    np = numpy_module()
    pytesseract = pytesseract_module()
    embedded_text = extract_pdf_text_with_reader(payload)
    if embedded_text:
        return embedded_text, {
            "method": "pdf_text_layer",
            "dependency_status": {
                "pypdf": PdfReader is not None,
            },
            "message": "Extracted embedded PDF text without OCR.",
        }

    dependency_status = {
        "pypdf": PdfReader is not None,
        "pdf2image": convert_from_path is not None,
        "pillow": Image is not None,
        "opencv": cv2 is not None,
        "numpy": np is not None,
        "pytesseract": pytesseract is not None,
        "tesseract_binary": tesseract_runtime_available(),
    }
    if not all(dependency_status.values()):
        fallback_text = extract_pdf_text_fallback(payload)
        message = "PDF OCR dependencies are not fully installed; used embedded-text fallback."
        if not fallback_text:
            message = "PDF OCR dependencies are not fully installed and no embedded text was found."
        return fallback_text, {
            "method": "pdf_embedded_text_fallback",
            "dependency_status": dependency_status,
            "message": message,
        }

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_pdf = Path(temp_dir) / "input.pdf"
            temp_pdf.write_bytes(payload)
            images = convert_from_path(str(temp_pdf))
            extracted_pages = []
            for image in images:
                img_bytes = io.BytesIO()
                image.save(img_bytes, format="PNG")
                page_text, _ = run_ocr_on_image(img_bytes.getvalue())
                if page_text:
                    extracted_pages.append(page_text)
            text = "\n".join(extracted_pages)
            if not text:
                text = extract_pdf_text_fallback(payload)
            return sanitize_text(text), {
                "method": "tesseract_pdf",
                "dependency_status": dependency_status,
                "message": "OCR completed on PDF content.",
            }
    except Exception as exc:
        fallback_text = extract_pdf_text_fallback(payload)
        return fallback_text, {
            "method": "pdf_embedded_text_fallback",
            "dependency_status": dependency_status,
            "message": f"PDF OCR failed, fallback used: {exc}",
        }


def extract_document_text(filename: str, payload: bytes, content_type: Optional[str]) -> Tuple[str, Dict[str, Any]]:
    suffix = Path(filename).suffix.lower()
    content_type = content_type or ""
    if suffix in {".txt", ".csv", ".json"} or content_type.startswith("text/"):
        text = try_decode_bytes(payload)
        return sanitize_text(text), {
            "method": "direct_decode",
            "message": "Decoded text-based document directly.",
        }

    if suffix == ".pdf" or content_type == "application/pdf":
        return run_ocr_on_pdf(payload)

    if suffix in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"} or content_type.startswith("image/"):
        return run_ocr_on_image(payload)

    fallback = try_decode_bytes(payload)
    return sanitize_text(fallback), {
        "method": "best_effort_decode",
        "message": "Used best-effort byte decoding for unsupported file type.",
    }


def first_match(patterns: List[str], text: str) -> Optional[str]:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            return sanitize_text(match.group(1))
    return None


def extract_aadhaar_candidates(text: str) -> List[str]:
    raw_matches = re.findall(r"(?:\d[\s-]?){12}", text)
    candidates = []
    for match in raw_matches:
        digits = re.sub(r"\D", "", match)
        if len(digits) == 12:
            candidates.append(digits)
    return list(dict.fromkeys(candidates))


def extract_year_candidates(text: str) -> List[str]:
    return list(dict.fromkeys(re.findall(r"\b(19\d{2}|20\d{2})\b", text)))


def extract_structured_fields(text: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    extracted = {field: None for field in FIELD_PATTERNS}
    for field, patterns in FIELD_PATTERNS.items():
        extracted[field] = first_match(patterns, text)

    location_boundaries = None
    for pattern in LOCATION_BOUNDARY_PATTERNS:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL)
        if match:
            location_boundaries = [sanitize_text(line) for line in match.group(1).splitlines() if sanitize_text(line)]
            break
    extracted["location_boundaries"] = location_boundaries

    metadata_defaults = {
        "claimant_name": metadata.get("claimant_name"),
        "village": metadata.get("village"),
        "district": metadata.get("district"),
        "state": metadata.get("state"),
    }
    for field, value in metadata_defaults.items():
        if not extracted.get(field) and value:
            extracted[field] = sanitize_text(value)

    aadhaar_candidates = extract_aadhaar_candidates(text)
    if aadhaar_candidates and not extracted.get("aadhaar_number"):
        extracted["aadhaar_number"] = aadhaar_candidates[0]

    extracted["years_mentioned"] = extract_year_candidates(text)
    extracted["text_length"] = len(text)
    extracted["document_signals"] = {
        "has_aadhaar_candidate": bool(aadhaar_candidates),
        "has_location_boundary_section": bool(extracted.get("location_boundaries")),
        "has_land_extent": bool(extracted.get("extent_of_land")),
    }

    extracted["normalized"] = {
        "claimant_name": normalize_text(extracted.get("claimant_name")),
        "village": normalize_text(extracted.get("village")),
        "district": normalize_text(extracted.get("district")),
        "state": normalize_text(extracted.get("state")),
        "aadhaar_number": re.sub(r"\D", "", extracted.get("aadhaar_number") or ""),
    }
    return extracted


def parse_existing_model_fields(model_result_raw: Optional[str]) -> Dict[str, Any]:
    data = safe_json_loads(model_result_raw)
    extracted = data.get("extracted_fields")
    return extracted if isinstance(extracted, dict) else {}


def score_duplicate_candidate(current: Dict[str, Any], candidate: Dict[str, Any]) -> Tuple[float, List[str]]:
    reasons: List[str] = []
    score = 0.0

    current_norm = current.get("normalized", {})
    candidate_norm = {
        "claimant_name": normalize_text(candidate.get("claimant_name")),
        "village": normalize_text(candidate.get("village")),
        "district": normalize_text(candidate.get("district")),
        "state": normalize_text(candidate.get("state")),
        "aadhaar_number": re.sub(r"\D", "", candidate.get("aadhaar_number") or ""),
    }

    if current_norm.get("aadhaar_number") and current_norm["aadhaar_number"] == candidate_norm.get("aadhaar_number"):
        score += 0.6
        reasons.append("Exact Aadhaar number match.")

    exact_pairs = [
        ("claimant_name", 0.18, "Exact claimant name match."),
        ("village", 0.08, "Exact village match."),
        ("district", 0.06, "Exact district match."),
        ("state", 0.04, "Exact state match."),
    ]
    for key, weight, reason in exact_pairs:
        if current_norm.get(key) and current_norm[key] == candidate_norm.get(key):
            score += weight
            reasons.append(reason)

    fuzzy_pairs = [
        ("claimant_name", 0.22, "High claimant name similarity."),
        ("village", 0.10, "High village similarity."),
        ("district", 0.08, "High district similarity."),
    ]
    for key, weight, reason in fuzzy_pairs:
        left = current_norm.get(key)
        right = candidate_norm.get(key)
        if left and right and left != right:
            similarity = SequenceMatcher(None, left, right).ratio()
            if similarity >= 0.92:
                score += weight
                reasons.append(f"{reason} ({similarity:.2f}).")
            elif similarity >= 0.82:
                score += weight * 0.5
                reasons.append(f"Moderate {key.replace('_', ' ')} similarity ({similarity:.2f}).")

    current_tokens = tokens(current.get("claimant_name"))
    candidate_tokens = tokens(candidate.get("claimant_name"))
    if current_tokens and candidate_tokens:
        overlap = len(current_tokens & candidate_tokens) / max(len(current_tokens), len(candidate_tokens))
        if overlap >= 0.75:
            score += 0.08
            reasons.append(f"Strong claimant token overlap ({overlap:.2f}).")

    if current.get("location_boundaries") and candidate.get("location_boundaries"):
        current_boundary = normalize_text(" ".join(current.get("location_boundaries") or []))
        candidate_boundary = normalize_text(" ".join(candidate.get("location_boundaries") or []))
        if current_boundary and candidate_boundary:
            similarity = SequenceMatcher(None, current_boundary, candidate_boundary).ratio()
            if similarity >= 0.88:
                score += 0.08
                reasons.append(f"High boundary description similarity ({similarity:.2f}).")

    return min(score, 0.99), reasons


def normalize_candidate_record(record: Dict[str, Any]) -> Dict[str, Any]:
    prior_fields = parse_existing_model_fields(record.get("model_result"))
    return {
        "id": record.get("id"),
        "claimant_name": prior_fields.get("claimant_name") or record.get("claimant_name"),
        "village": prior_fields.get("village") or record.get("village"),
        "district": prior_fields.get("district") or record.get("district"),
        "state": prior_fields.get("state") or record.get("state"),
        "aadhaar_number": prior_fields.get("aadhaar_number"),
        "location_boundaries": prior_fields.get("location_boundaries"),
        "status": record.get("status"),
        "created_at": record.get("created_at"),
    }


def load_claim_candidates(db_path: Path, current_claim_id: Optional[int]) -> List[Dict[str, Any]]:
    if not db_path.exists():
        return []

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, claimant_name, village, district, state, status, model_result, created_at
            FROM claims
            WHERE (? IS NULL OR id <> ?)
            ORDER BY created_at DESC
            """,
            (current_claim_id, current_claim_id),
        ).fetchall()
    finally:
        conn.close()

    return [normalize_candidate_record(dict(row)) for row in rows]


def load_claim_candidates_from_metadata(metadata: Dict[str, Any], current_claim_id: Optional[int]) -> List[Dict[str, Any]]:
    raw_candidates = metadata.get("existing_claims") or metadata.get("existingClaims") or []
    if not isinstance(raw_candidates, list):
        return []

    normalized = []
    for item in raw_candidates:
        if not isinstance(item, dict):
            continue
        if current_claim_id is not None and str(item.get("id")) == str(current_claim_id):
            continue
        normalized.append(normalize_candidate_record(item))
    return normalized


def detect_duplicates(
    extracted_fields: Dict[str, Any],
    metadata: Dict[str, Any],
    db_path: Path,
) -> Dict[str, Any]:
    claim_id = metadata.get("claimId")
    try:
        claim_id = int(claim_id) if claim_id is not None else None
    except (TypeError, ValueError):
        claim_id = None

    candidates = load_claim_candidates_from_metadata(metadata, claim_id)
    if not candidates:
        candidates = load_claim_candidates(db_path, claim_id)
    matches = []
    for candidate in candidates:
        score, reasons = score_duplicate_candidate(extracted_fields, candidate)
        if score >= 0.45:
            matches.append(
                {
                    "claim_id": candidate["id"],
                    "score": round(score, 4),
                    "status": candidate.get("status"),
                    "matched_fields": {
                        "claimant_name": candidate.get("claimant_name"),
                        "village": candidate.get("village"),
                        "district": candidate.get("district"),
                        "state": candidate.get("state"),
                    },
                    "reasons": reasons,
                }
            )

    matches.sort(key=lambda item: item["score"], reverse=True)
    top_score = matches[0]["score"] if matches else 0.0
    flagged = top_score >= 0.7
    explanation = (
        "Likely duplicate claim based on strong field overlap."
        if flagged
        else "No strong duplicate detected."
    )
    if matches and not flagged:
        explanation = "Potential duplicate candidates found; manual review recommended."

    return {
        "is_duplicate": flagged,
        "duplicate_score": round(top_score, 4),
        "matched_claim_ids": [match["claim_id"] for match in matches],
        "candidate_matches": matches[:5],
        "explanation": explanation,
        "matching_strategy": {
            "exact_fields": ["aadhaar_number", "claimant_name", "village", "district", "state"],
            "fuzzy_fields": ["claimant_name", "village", "district", "location_boundaries"],
        },
    }


def build_document_result(document: UploadFile, payload: bytes, metadata: Dict[str, Any]) -> Dict[str, Any]:
    text, extraction_info = extract_document_text(document.filename or "unknown", payload, document.content_type)
    structured_fields = extract_structured_fields(text, metadata)
    return {
        "filename": document.filename,
        "size_bytes": len(payload),
        "content_type": document.content_type or None,
        "ocr": extraction_info,
        "text": text,
        "structured_fields": structured_fields,
    }


def merge_document_results(results: List[Dict[str, Any]], metadata: Dict[str, Any]) -> Dict[str, Any]:
    combined_text = "\n".join(result["text"] for result in results if result.get("text")).strip()
    merged = {field: None for field in FIELD_PATTERNS}
    merged["location_boundaries"] = None

    for result in results:
        structured = result.get("structured_fields", {})
        for field in FIELD_PATTERNS:
            if not merged.get(field) and structured.get(field):
                merged[field] = structured[field]
        if not merged.get("location_boundaries") and structured.get("location_boundaries"):
            merged["location_boundaries"] = structured["location_boundaries"]

    enriched = extract_structured_fields(combined_text, metadata)
    for key, value in merged.items():
        if value and not enriched.get(key):
            enriched[key] = value
    return enriched


def estimate_extraction_confidence(extracted_fields: Dict[str, Any], duplicate_analysis: Dict[str, Any], document_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    key_fields = ["claimant_name", "village", "district", "state", "aadhaar_number", "extent_of_land"]
    populated = sum(1 for field in key_fields if extracted_fields.get(field))
    confidence = 0.25 + (populated / len(key_fields)) * 0.45

    successful_docs = sum(1 for item in document_results if item.get("text"))
    if document_results:
        confidence += min(successful_docs / len(document_results), 1.0) * 0.2

    if duplicate_analysis.get("duplicate_score", 0) >= 0.85:
        confidence += 0.05

    confidence = min(round(confidence, 4), 0.99)
    return {
        "overall": confidence,
        "populated_key_fields": populated,
        "total_key_fields": len(key_fields),
        "documents_with_text": successful_docs,
        "total_documents": len(document_results),
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    Image = pil_image_module()
    cv2 = cv2_module()
    np = numpy_module()
    pytesseract = pytesseract_module()
    convert_from_path = convert_from_path_fn()
    PdfReader = pdf_reader_cls()
    return {
        "status": "ok",
        "time": utc_now_iso(),
        "ocr_dependencies": {
            "PIL": Image is not None,
            "cv2": cv2 is not None,
            "numpy": np is not None,
            "pytesseract": pytesseract is not None,
            "pdf2image": convert_from_path is not None,
            "pypdf": PdfReader is not None,
            "tesseract_binary": tesseract_runtime_available(),
        },
        "ocr_config": {
            "tesseract_cmd": getattr(pytesseract.pytesseract, "tesseract_cmd", "") if pytesseract is not None else "",
            "language": TESSERACT_LANG,
            "psm": TESSERACT_PSM,
            "oem": TESSERACT_OEM,
        },
        "database_path": str(DEFAULT_DB_PATH),
    }


@app.post("/predict")
async def predict(
    documents: List[UploadFile] = File(default=[]),
    metadata: Optional[str] = Form(default=None),
) -> JSONResponse:
    Image = pil_image_module()
    cv2 = cv2_module()
    np = numpy_module()
    pytesseract = pytesseract_module()
    convert_from_path = convert_from_path_fn()
    PdfReader = pdf_reader_cls()
    parsed_metadata = {}
    if metadata:
        try:
            parsed_metadata = json.loads(metadata)
        except Exception:
            parsed_metadata = {"raw": metadata}

    document_results = []
    for document in documents:
        payload = await document.read()
        try:
            document_results.append(build_document_result(document, payload, parsed_metadata))
        finally:
            await document.close()

    extracted_fields = merge_document_results(document_results, parsed_metadata)
    duplicate_analysis = detect_duplicates(extracted_fields, parsed_metadata, DEFAULT_DB_PATH)
    combined_text = "\n".join(item["text"] for item in document_results if item.get("text")).strip()
    extraction_confidence = estimate_extraction_confidence(extracted_fields, duplicate_analysis, document_results)

    result = {
        "summary": f"Processed {len(document_results)} document(s)",
        "metadata": parsed_metadata,
        "documents": [
            {
                "filename": item["filename"],
                "size_bytes": item["size_bytes"],
                "content_type": item["content_type"],
                "ocr": item["ocr"],
            }
            for item in document_results
        ],
        "ocr_text": combined_text,
        "extracted_fields": extracted_fields,
        "duplicate_analysis": duplicate_analysis,
        "extraction_confidence": extraction_confidence,
        "service_readiness": {
            "can_ocr_images": all([
                Image is not None,
                cv2 is not None,
                np is not None,
                pytesseract is not None,
                tesseract_runtime_available(),
            ]),
            "can_extract_pdf_text": PdfReader is not None or convert_from_path is not None,
        },
        "run_at": utc_now_iso(),
        "model_version": "fra-ocr-dedupe-1.1",
    }

    artifact_name = f"predict-{parsed_metadata.get('claimId', 'unknown')}-{datetime.now().strftime('%Y%m%d%H%M%S')}.json"
    try:
        (ARTIFACTS_DIR / artifact_name).write_text(json.dumps(result, indent=2), encoding="utf-8")
    except Exception:
        pass

    return JSONResponse(content=result)


@app.post("/pipeline/run")
async def run_pipeline(req: PipelineRequest) -> JSONResponse:
    try:
        if req.claim is not None:
            result = MLPipeline.run_from_payload(
                {
                    "claim": req.claim,
                    "existing_claims": req.existing_claims or [],
                    "model_result": req.model_result or {},
                }
            )
            return JSONResponse(content={"status": "ok", "mode": "payload", "claim_id": req.claim_id, "result": result})

        if req.claim_id is None:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "claim_id is required when claim payload is not provided"},
            )

        result = MLPipeline.run(req.claim_id)
        return JSONResponse(content={"status": "ok", "mode": "db", "claim_id": req.claim_id, "result": result})
    except PipelineError as exc:
        return JSONResponse(
            status_code=422,
            content={"status": "error", "stage": exc.stage, "message": str(exc), "claim_id": req.claim_id},
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": str(exc), "claim_id": req.claim_id},
        )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
