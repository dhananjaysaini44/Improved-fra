from __future__ import annotations

import json
import os
import re
from typing import Any, Dict

from ml_pipeline.config import config
from ml_pipeline.db import queries

_CACHE: dict[str, list[dict[str, Any]]] = {}


def _normalize(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9/\-\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _first(props: Dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in props and props[key] not in (None, ""):
            return props[key]
    return None


def _reference_dir() -> str:
    return os.path.abspath(config.PARCEL_REFERENCE_DIR)


def _load_reference_records() -> list[dict[str, Any]]:
    root = _reference_dir()
    if root in _CACHE:
        return _CACHE[root]

    files = [
        "parcel_records.geojson",
        "parcel_records.json",
        "land_records.geojson",
        "land_records.json",
        "forest_compartments.geojson",
        "forest_compartments.json",
    ]

    records: list[dict[str, Any]] = []
    for filename in files:
        full_path = os.path.join(root, filename)
        if not os.path.exists(full_path):
            continue
        try:
            with open(full_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            continue

        entries: list[tuple[dict[str, Any], Any]] = []
        if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
            for feature in payload.get("features", []):
                if isinstance(feature, dict):
                    entries.append((feature.get("properties") or {}, feature.get("geometry")))
        elif isinstance(payload, dict) and isinstance(payload.get("records"), list):
            for entry in payload.get("records", []):
                if isinstance(entry, dict):
                    entries.append((entry, entry.get("geometry")))
        elif isinstance(payload, list):
            for entry in payload:
                if isinstance(entry, dict):
                    entries.append((entry, entry.get("geometry")))

        source_name = os.path.splitext(filename)[0]
        for props, geometry in entries:
            record = {
                "reference_id": _first(props, ["reference_id", "parcel_id", "id", "survey_id", "record_id", "compartment_id"]) or source_name,
                "survey_number": _first(props, ["survey_number", "survey_no", "surveyNo"]),
                "khata_number": _first(props, ["khata_number", "khata_no", "khataNo"]),
                "hissa_number": _first(props, ["hissa_number", "hissa_no", "hissaNo"]),
                "forest_compartment": _first(props, ["forest_compartment", "compartment", "compartment_no"]),
                "forest_beat": _first(props, ["forest_beat", "beat", "beat_name"]),
                "forest_range": _first(props, ["forest_range", "range", "range_name"]),
                "village": _first(props, ["village", "village_name"]),
                "district": _first(props, ["district", "district_name"]),
                "state": _first(props, ["state", "state_name"]),
                "area_ha": _first(props, ["area_ha", "area", "area_hectare"]),
                "land_cover_type": _first(props, ["land_cover_type", "land_use", "land_type"]),
                "is_restricted": bool(_first(props, ["is_restricted", "restricted"])),
                "survey_date": _first(props, ["survey_date", "updated_at", "recorded_at"]),
                "source_name": source_name,
                "geometry": geometry,
            }
            records.append(record)

    _CACHE[root] = records
    return records


def _polygon_from_claim(claim: Dict[str, Any]) -> Any:
    polygon = claim.get("polygon")
    if isinstance(polygon, str):
        try:
            polygon = json.loads(polygon)
        except Exception:
            polygon = None
    return polygon


def _area_number(value: Any) -> float | None:
    if value is None:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", str(value))
    if not match:
        return None
    try:
        return float(match.group(1))
    except Exception:
        return None


def _geometry_score(claim_polygon: Any, record_geometry: Any) -> tuple[float, list[str]]:
    if not claim_polygon or not record_geometry:
        return 0.0, []
    try:
        from shapely.geometry import shape
    except Exception:
        return 0.0, []

    try:
        claim_shape = shape(claim_polygon)
        record_shape = shape(record_geometry)
    except Exception:
        return 0.0, []

    evidence: list[str] = []
    score = 0.0
    if claim_shape.intersects(record_shape):
        score += 0.2
        evidence.append("claim polygon intersects reference geometry")
    else:
        try:
            distance = float(claim_shape.centroid.distance(record_shape.centroid))
            if distance < 0.01:
                score += 0.08
                evidence.append("claim polygon centroid is close to reference geometry")
        except Exception:
            pass
    return score, evidence


def _score_record(claim: Dict[str, Any], extracted_fields: Dict[str, Any], record: Dict[str, Any]) -> tuple[float, list[str]]:
    score = 0.0
    evidence: list[str] = []

    identifier_weights = {
        "survey_number": 0.35,
        "khata_number": 0.25,
        "hissa_number": 0.1,
        "forest_compartment": 0.35,
        "forest_beat": 0.08,
        "forest_range": 0.08,
    }
    location_weights = {
        "village": 0.06,
        "district": 0.05,
        "state": 0.04,
    }

    for field, weight in identifier_weights.items():
        extracted_value = _normalize(extracted_fields.get(field))
        record_value = _normalize(record.get(field))
        if extracted_value and record_value and extracted_value == record_value:
            score += weight
            evidence.append(f"{field.replace('_', ' ')} matched")

    for field, weight in location_weights.items():
        claim_value = _normalize(extracted_fields.get(field) or claim.get(field))
        record_value = _normalize(record.get(field))
        if claim_value and record_value and claim_value == record_value:
            score += weight
            evidence.append(f"{field} matched")

    claimed_area = _area_number(extracted_fields.get("land_area_ha") or extracted_fields.get("extent_of_land"))
    record_area = _area_number(record.get("area_ha"))
    if claimed_area and record_area:
        discrepancy = abs(claimed_area - record_area) / max(claimed_area, record_area)
        if discrepancy <= 0.2:
            score += 0.06
            evidence.append("record area matched OCR area")
        elif discrepancy <= 0.4:
            score += 0.03
            evidence.append("record area close to OCR area")

    geometry_score, geometry_evidence = _geometry_score(_polygon_from_claim(claim), record.get("geometry"))
    score += geometry_score
    evidence.extend(geometry_evidence)

    return min(round(score, 4), 1.0), evidence


def _build_candidate(record: Dict[str, Any], score: float, evidence: list[str]) -> Dict[str, Any]:
    return {
        "reference_id": record.get("reference_id"),
        "match_confidence": round(score, 4),
        "match_basis": evidence,
        "source_name": record.get("source_name"),
        "survey_number": record.get("survey_number"),
        "khata_number": record.get("khata_number"),
        "hissa_number": record.get("hissa_number"),
        "forest_compartment": record.get("forest_compartment"),
        "forest_beat": record.get("forest_beat"),
        "forest_range": record.get("forest_range"),
        "village": record.get("village"),
        "district": record.get("district"),
        "state": record.get("state"),
        "area_ha": _area_number(record.get("area_ha")),
        "land_cover_type": record.get("land_cover_type"),
        "is_restricted": bool(record.get("is_restricted")),
        "survey_date": record.get("survey_date"),
        "boundaries_geojson": record.get("geometry"),
    }


def match_from_payload(claim: Dict[str, Any], extracted_fields: Dict[str, Any]) -> Dict[str, Any]:
    records = _load_reference_records()
    if not records:
        return {
            "source_available": False,
            "candidate_matches": [],
            "best_match": None,
            "checked_identifiers": [],
        }

    candidates: list[Dict[str, Any]] = []
    for record in records:
        score, evidence = _score_record(claim, extracted_fields, record)
        if score < 0.18:
            continue
        candidates.append(_build_candidate(record, score, evidence))

    candidates.sort(key=lambda item: item.get("match_confidence", 0.0), reverse=True)
    best_match = candidates[0] if candidates else None
    if best_match and best_match.get("match_confidence", 0.0) < 0.3:
        best_match = None

    checked_identifiers = [
        field
        for field in ["survey_number", "khata_number", "hissa_number", "forest_compartment", "forest_beat", "forest_range"]
        if extracted_fields.get(field)
    ]

    return {
        "source_available": True,
        "candidate_matches": candidates[:5],
        "best_match": best_match,
        "checked_identifiers": checked_identifiers,
    }


def run(claim_id: int, ocr: Dict[str, Any] | None = None) -> Dict[str, Any]:
    claim = queries.get_claim(claim_id)
    extracted_fields = {}
    if isinstance(ocr, dict):
        extracted_fields = ocr.get("structured_fields") or {}
    result = match_from_payload(claim, extracted_fields)
    queries.save_land_parcel_result(claim_id, result)
    return result
