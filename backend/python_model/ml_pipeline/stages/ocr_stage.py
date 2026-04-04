from __future__ import annotations

import io
import os
import re
import tarfile
from typing import Any, Dict
import importlib

from ml_pipeline.db import queries

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
    "village": [r"Village\s*[:\-]\s*(.+)"],
    "gram_panchayat": [
        r"Gram Panchayat\s*[:\-]\s*(.+)",
        r"G\.?\s*P\.?\s*[:\-]\s*(.+)",
        r"Panchayat\s*[:\-]\s*(.+)",
    ],
    "tehsil_taluka": [
        r"Tehsil/Taluka\s*[:\-]\s*(.+)",
        r"Tehsil\s*[:\-]\s*(.+)",
        r"Taluka\s*[:\-]\s*(.+)",
        r"Taluk\s*[:\-]\s*(.+)",
    ],
    "district": [r"District\s*[:\-]\s*(.+)"],
    "state": [r"State\s*[:\-]\s*(.+)"],
    "aadhaar_number": [
        r"Aadhaar(?: Card)? No\.?\s*[:\-]\s*([0-9Xx\-\s]{8,20})",
        r"Aadhaar\s*[:\-]\s*([0-9Xx\-\s]{8,20})",
    ],
    "type_of_right": [
        r"Type of Right Claimed\s*[:\-]\s*(.+)",
        r"Type of Right\s*[:\-]\s*(.+)",
    ],
    "purpose_of_land_use": [r"Purpose of Land Use\s*[:\-]\s*(.+)"],
    "extent_of_land": [
        r"Extent of Land\s*[:\-]\s*(.+)",
        r"Land Area\s*[:\-]\s*(.+)",
    ],
    "survey_number": [
        r"Survey(?: No| Number)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
        r"S\.\s*No\.?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
    ],
    "khasra_number": [
        r"Khasra(?: No| Number)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
        r"Khasra\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
    ],
    "khata_number": [
        r"Khata(?: No| Number)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
        r"Khatha(?: No| Number)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
        r"Patta(?: No| Number)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
    ],
    "village_code": [
        r"Village Code\s*[:\-]\s*([0-9A-Za-z/\-]{2,30})",
    ],
    "tehsil_code": [
        r"Tehsil Code\s*[:\-]\s*([0-9A-Za-z/\-]{2,30})",
    ],
    "patwari_name": [
        r"Patwari Name\s*[:\-]\s*(.+?)(?=\s+(?:Village Code|Tehsil Code|Date|Occupation|Record|Verification|Renewal|$))",
    ],
    "hissa_number": [
        r"Hissa(?: No| Number)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,20})",
        r"Sub(?:division)?\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,20})",
    ],
    "forest_compartment": [
        r"Forest Compartment\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
        r"Compartment\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
        r"Comp\.\s*[:#\-]?\s*([0-9A-Za-z/\-]{1,30})",
    ],
    "forest_beat": [
        r"Forest Beat\s*[:#\-]?\s*([A-Za-z0-9\s\-]{2,40})",
        r"Beat\s*[:#\-]?\s*([A-Za-z0-9\s\-]{2,40})",
    ],
    "forest_range": [
        r"Forest Range\s*[:#\-]?\s*([A-Za-z0-9\s\-]{2,40})",
        r"Range\s*[:#\-]?\s*([A-Za-z0-9\s\-]{2,40})",
    ],
    "boundary_north": [r"North\s*[:\-]\s*(.+?)(?=\n|South|East|West|$)"],
    "boundary_south": [r"South\s*[:\-]\s*(.+?)(?=\n|North|East|West|$)"],
    "boundary_east": [r"East\s*[:\-]\s*(.+?)(?=\n|North|South|West|$)"],
    "boundary_west": [r"West\s*[:\-]\s*(.+?)(?=\n|North|South|East|$)"],
    "land_area_ha": [r"([0-9]+(?:\.[0-9]+)?)\s*(?:hectare|hectares|ha\b)"],
    "pin_code": [r"\b([1-9][0-9]{5})\b"],
    "attached_map": [r"Attached Map\s*[:\-]\s*(.+)"],
    "supporting_evidence": [r"Supporting Evidence(?: of Occupation)?\s*[:\-]\s*(.+)"],
    "photo_exif_lat": [],
    "photo_exif_lon": [],
}

LOCATION_BOUNDARY_PATTERNS = [
    r"Description of Location and Boundaries\s*[:\-]\s*(.+?)(?:\n\s*\d+\.\s|\Z)",
    r"Location and Boundaries\s*[:\-]\s*(.+?)(?:\n\s*\d+\.\s|\Z)",
]

_OPTIONAL_IMPORTS: dict[str, Any] = {}


def _load_optional(module_name: str, attr: str | None = None) -> Any:
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


def _sanitize_text(value: Any) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _normalize_text(value: Any) -> str:
    value = _sanitize_text(value).lower()
    value = re.sub(r"\b(s/o|d/o|w/o)\b", " ", value)
    value = re.sub(r"\bmr\b|\bmrs\b|\bms\b|\bshri\b|\bsmt\b", " ", value)
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            return _sanitize_text(match.group(1))
    return None


def _extract_aadhaar_candidates(text: str) -> list[str]:
    raw_matches = re.findall(r"(?:\d[\s-]?){12}", text)
    candidates = []
    for match in raw_matches:
        digits = re.sub(r"\D", "", match)
        if len(digits) == 12:
            candidates.append(digits)
    return list(dict.fromkeys(candidates))


def _extract_year_candidates(text: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"\b(19\d{2}|20\d{2})\b", text)))


def _best_effort_text(filename: str, payload: bytes) -> str:
    suffix = os.path.splitext(filename)[1].lower()
    if suffix in {".txt", ".csv", ".json"}:
        return payload.decode("utf-8", errors="ignore")

    if suffix == ".pdf":
        PdfReader = _load_optional("pypdf", "PdfReader")
        if PdfReader is not None:
            try:
                import io as _io
                reader = PdfReader(_io.BytesIO(payload))
                parts = []
                for page in reader.pages:
                    page_text = page.extract_text() or ""
                    if page_text.strip():
                        parts.append(page_text)
                if parts:
                    return "\n".join(parts)
            except Exception:
                pass

    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return payload.decode(encoding)
        except Exception:
            continue
    return ""


def _convert_exif_coord(value: Any, ref: str | None) -> float | None:
    try:
        parts = list(value)
        if len(parts) != 3:
            return None

        def _to_float(part: Any) -> float:
            if isinstance(part, tuple) and len(part) == 2 and part[1]:
                return float(part[0]) / float(part[1])
            if hasattr(part, "numerator") and hasattr(part, "denominator") and part.denominator:
                return float(part.numerator) / float(part.denominator)
            return float(part)

        degrees = _to_float(parts[0])
        minutes = _to_float(parts[1])
        seconds = _to_float(parts[2])
        decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
        if str(ref or "").upper() in {"S", "W"}:
            decimal *= -1
        return round(decimal, 8)
    except Exception:
        return None


def _extract_exif_gps(payload: bytes) -> dict[str, Any]:
    if not payload.startswith(b"\xff\xd8"):
        return {"photo_exif_lat": None, "photo_exif_lon": None}

    Image = _load_optional("PIL.Image")
    ExifTags = _load_optional("PIL.ExifTags")
    if Image is None or ExifTags is None:
        return {"photo_exif_lat": None, "photo_exif_lon": None}

    try:
        image = Image.open(io.BytesIO(payload))
        exif = None
        try:
            exif = image.getexif()
        except Exception:
            exif = None
        if not exif and hasattr(image, "_getexif"):
            try:
                exif = image._getexif()
            except Exception:
                exif = None
        if not exif:
            return {"photo_exif_lat": None, "photo_exif_lon": None}

        gps_tag_id = next((tag_id for tag_id, name in ExifTags.TAGS.items() if name == "GPSInfo"), None)
        gps_info = exif.get(gps_tag_id) if gps_tag_id is not None else None
        if not gps_info:
            return {"photo_exif_lat": None, "photo_exif_lon": None}

        gps_tags = ExifTags.GPSTAGS
        mapped = {gps_tags.get(tag_id, tag_id): gps_info[tag_id] for tag_id in gps_info}
        return {
            "photo_exif_lat": _convert_exif_coord(mapped.get("GPSLatitude"), mapped.get("GPSLatitudeRef")),
            "photo_exif_lon": _convert_exif_coord(mapped.get("GPSLongitude"), mapped.get("GPSLongitudeRef")),
        }
    except Exception:
        return {"photo_exif_lat": None, "photo_exif_lon": None}


def _extract_structured_fields(text: str) -> dict[str, Any]:
    extracted = {field: None for field in FIELD_PATTERNS}
    for field, patterns in FIELD_PATTERNS.items():
        extracted[field] = _first_match(patterns, text)

    location_boundaries = None
    for pattern in LOCATION_BOUNDARY_PATTERNS:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL)
        if match:
            location_boundaries = [_sanitize_text(line) for line in match.group(1).splitlines() if _sanitize_text(line)]
            break
    extracted["location_boundaries"] = location_boundaries

    aadhaar_candidates = _extract_aadhaar_candidates(text)
    if aadhaar_candidates and not extracted.get("aadhaar_number"):
        extracted["aadhaar_number"] = aadhaar_candidates[0]

    if not extracted.get("khasra_number") and extracted.get("survey_number"):
        extracted["khasra_number"] = extracted["survey_number"]
    if not extracted.get("survey_number") and extracted.get("khasra_number"):
        extracted["survey_number"] = extracted["khasra_number"]
    extracted["khasra_no"] = extracted.get("khasra_number")
    extracted["khata_no"] = extracted.get("khata_number")
    extracted["land_area_hectares"] = extracted.get("land_area_ha")

    extracted["years_mentioned"] = _extract_year_candidates(text)
    extracted["text_length"] = len(text)
    extracted["document_signals"] = {
        "has_aadhaar_candidate": bool(aadhaar_candidates),
        "has_location_boundary_section": bool(extracted.get("location_boundaries")),
        "has_land_extent": bool(extracted.get("extent_of_land")),
        "has_survey_number": bool(extracted.get("survey_number")),
        "has_forest_reference": bool(extracted.get("forest_compartment") or extracted.get("forest_beat") or extracted.get("forest_range")),
        "has_exif_coordinates": bool(extracted.get("photo_exif_lat") is not None and extracted.get("photo_exif_lon") is not None),
    }
    extracted["normalized"] = {
        "claimant_name": _normalize_text(extracted.get("claimant_name")),
        "village": _normalize_text(extracted.get("village")),
        "district": _normalize_text(extracted.get("district")),
        "state": _normalize_text(extracted.get("state")),
        "aadhaar_number": re.sub(r"\D", "", extracted.get("aadhaar_number") or ""),
    }
    return extracted


def run(claim_id: int) -> Dict[str, Any]:
    docs = queries.get_claim_documents(claim_id)
    if not docs:
        return {"ocr_score": 0.0, "documents_processed": 0, "structured_fields": {}}

    processed = 0
    non_empty = 0
    merged_fields = {field: None for field in FIELD_PATTERNS}
    merged_fields["location_boundaries"] = None
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
            raw_text = _sanitize_text(_best_effort_text(doc_name, payload))
            structured_fields = _extract_structured_fields(raw_text)
            exif_fields = _extract_exif_gps(payload)
            for key, value in exif_fields.items():
                if structured_fields.get(key) is None:
                    structured_fields[key] = value
            structured_fields["document_signals"]["has_exif_coordinates"] = bool(
                structured_fields.get("photo_exif_lat") is not None and structured_fields.get("photo_exif_lon") is not None
            )
            for field in FIELD_PATTERNS:
                if merged_fields.get(field) is None and structured_fields.get(field) is not None:
                    merged_fields[field] = structured_fields[field]
            if merged_fields.get("location_boundaries") is None and structured_fields.get("location_boundaries"):
                merged_fields["location_boundaries"] = structured_fields["location_boundaries"]
            if raw_text.strip():
                non_empty += 1
            processed += 1
            queries.save_ocr_result(
                claim_id,
                doc_name,
                {
                    "raw_text": raw_text[:10000],
                    "structured_fields": structured_fields,
                    "accuracy": 1.0 if raw_text.strip() else 0.0,
                    "fields_complete_ratio": 1.0 if raw_text.strip() else 0.0,
                },
            )

    score = non_empty / processed if processed else 0.0
    merged_fields["document_signals"] = {
        "has_aadhaar_candidate": bool(merged_fields.get("aadhaar_number")),
        "has_location_boundary_section": bool(merged_fields.get("location_boundaries")),
        "has_land_extent": bool(merged_fields.get("extent_of_land")),
        "has_survey_number": bool(merged_fields.get("survey_number")),
        "has_forest_reference": bool(merged_fields.get("forest_compartment") or merged_fields.get("forest_beat") or merged_fields.get("forest_range")),
        "has_exif_coordinates": bool(merged_fields.get("photo_exif_lat") is not None and merged_fields.get("photo_exif_lon") is not None),
    }
    if not merged_fields.get("khasra_number") and merged_fields.get("survey_number"):
        merged_fields["khasra_number"] = merged_fields["survey_number"]
    if not merged_fields.get("survey_number") and merged_fields.get("khasra_number"):
        merged_fields["survey_number"] = merged_fields["khasra_number"]
    merged_fields["khasra_no"] = merged_fields.get("khasra_number")
    merged_fields["khata_no"] = merged_fields.get("khata_number")
    merged_fields["land_area_hectares"] = merged_fields.get("land_area_ha")
    return {
        "ocr_score": round(score, 4),
        "documents_processed": processed,
        "structured_fields": merged_fields,
    }
