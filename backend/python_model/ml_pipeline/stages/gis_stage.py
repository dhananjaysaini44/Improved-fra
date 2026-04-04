from __future__ import annotations

import json
import os
import re
from typing import Any, Dict

from ml_pipeline.config import config
from ml_pipeline.db import queries

_BOUNDARY_CACHE: dict[str, list[dict[str, Any]] | None] = {}


def _parse_claimed_area_ha(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", str(value))
    if not match:
        return None
    try:
        return float(match.group(1))
    except Exception:
        return None


def _approx_polygon_area_ha(geojson: Dict[str, Any]) -> float | None:
    try:
        from shapely.geometry import shape
    except Exception:
        return None

    try:
        polygon = shape(geojson)
        area_degrees = float(polygon.area)
        area_m2 = area_degrees * (111320.0 ** 2)
        return area_m2 / 10000.0
    except Exception:
        return None


def _area_diagnostics(geojson: Dict[str, Any], structured_fields: Dict[str, Any] | None) -> Dict[str, Any]:
    structured_fields = structured_fields or {}
    claimed_ha = _parse_claimed_area_ha(structured_fields.get("land_area_ha") or structured_fields.get("extent_of_land"))
    polygon_ha = _approx_polygon_area_ha(geojson)
    if claimed_ha is None or polygon_ha is None or claimed_ha <= 0 or polygon_ha <= 0:
        return {}

    ratio = abs(polygon_ha - claimed_ha) / max(polygon_ha, claimed_ha)
    warnings: list[str] = []
    if ratio > 0.5:
        warnings.append("Submitted polygon area differs substantially from OCR-extracted land area.")

    return {
        "claimed_area_ha": round(claimed_ha, 4),
        "polygon_area_ha": round(polygon_ha, 4),
        "area_discrepancy_ratio": round(ratio, 4),
        "warnings": warnings,
    }


def _normalize_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _load_boundary_features(name: str) -> list[dict[str, Any]] | None:
    if name in _BOUNDARY_CACHE:
        return _BOUNDARY_CACHE[name]

    candidates = [
        os.path.join(config.BOUNDARY_DATA_DIR, f"{name}.geojson"),
        os.path.join(config.BOUNDARY_DATA_DIR, f"{name}.json"),
    ]
    data: list[dict[str, Any]] | None = None
    for candidate in candidates:
        if not os.path.exists(candidate):
            continue
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if payload.get("type") == "FeatureCollection":
                features = payload.get("features", [])
            elif payload.get("type") == "Feature":
                features = [payload]
            else:
                continue
            data = [feature for feature in features if isinstance(feature, dict) and feature.get("geometry")]
            break
        except Exception:
            data = None
    _BOUNDARY_CACHE[name] = data
    return data


def _match_boundary_feature(features: list[dict[str, Any]] | None, target_name: Any) -> dict[str, Any] | None:
    if not features or not target_name:
        return None
    wanted = _normalize_name(target_name)
    if not wanted:
        return None
    candidate_keys = ("name", "NAME", "state", "STATE", "district", "DISTRICT", "district_name", "state_name", "gram_panchayat", "GP_NAME")
    for feature in features:
        props = feature.get("properties") or {}
        for key in candidate_keys:
            if _normalize_name(props.get(key)) == wanted:
                return feature
    return None


def _boundary_validation(geojson: Dict[str, Any], claim: Dict[str, Any], structured_fields: Dict[str, Any] | None) -> Dict[str, Any]:
    structured_fields = structured_fields or {}
    try:
        from shapely.geometry import shape
    except Exception:
        return {}

    try:
        polygon = shape(geojson)
    except Exception:
        return {}

    centroid = polygon.centroid
    warnings: list[str] = []
    checks: Dict[str, Any] = {}

    state_feature = _match_boundary_feature(_load_boundary_features("states"), claim.get("state"))
    if state_feature:
        try:
            state_shape = shape(state_feature["geometry"])
            state_ok = bool(state_shape.contains(centroid) or state_shape.intersects(polygon))
            checks["state_boundary_match"] = state_ok
            if not state_ok:
                warnings.append("Claim geometry does not align with the declared state boundary.")
        except Exception:
            pass

    district_feature = _match_boundary_feature(_load_boundary_features("districts"), claim.get("district"))
    if district_feature:
        try:
            district_shape = shape(district_feature["geometry"])
            district_ok = bool(district_shape.contains(centroid) or district_shape.intersects(polygon))
            checks["district_boundary_match"] = district_ok
            if not district_ok:
                warnings.append("Claim geometry does not align with the declared district boundary.")
        except Exception:
            pass

    gp_name = structured_fields.get("gram_panchayat")
    gp_feature = _match_boundary_feature(_load_boundary_features("gram_panchayats"), gp_name)
    if gp_feature:
        try:
            gp_shape = shape(gp_feature["geometry"])
            gp_ok = bool(gp_shape.contains(centroid) or gp_shape.intersects(polygon))
            checks["gram_panchayat_boundary_match"] = gp_ok
            if not gp_ok:
                warnings.append("Claim geometry does not align with the OCR-extracted gram panchayat boundary.")
        except Exception:
            pass

    restricted_features = _load_boundary_features("restricted_areas")
    if restricted_features:
        restricted_hits = 0
        for feature in restricted_features:
            try:
                restricted_shape = shape(feature["geometry"])
                if restricted_shape.intersects(polygon):
                    restricted_hits += 1
            except Exception:
                continue
        if restricted_hits:
            checks["restricted_area_hits"] = restricted_hits
            warnings.append("Claim geometry intersects one or more restricted reference areas.")

    if not checks and not warnings:
        return {}

    result = dict(checks)
    if warnings:
        result["warnings"] = warnings
    return result


def run(claim_id: int, ocr: Dict[str, Any] | None = None) -> Dict[str, Any]:
    parcel = queries.get_land_parcel_for_claim(claim_id)
    if not parcel:
        return {"gis_score": 1.0, "conflicts": []}

    claim = queries.get_claim(claim_id)

    conflicts = queries.detect_spatial_conflicts(parcel["geojson"], claim_id)
    queries.save_spatial_conflicts(claim_id, conflicts)

    if not conflicts:
        score = 1.0
    else:
        score = max(0.0, 1.0 - min(len(conflicts), 5) * 0.2)

    diagnostics = _area_diagnostics(parcel["geojson"], (ocr or {}).get("structured_fields"))
    boundary_checks = _boundary_validation(parcel["geojson"], claim, (ocr or {}).get("structured_fields"))
    result = {"gis_score": round(score, 4), "conflicts": conflicts}
    result.update(diagnostics)
    if boundary_checks:
        existing_warnings = result.get("warnings", [])
        result.update({k: v for k, v in boundary_checks.items() if k != "warnings"})
        merged_warnings = existing_warnings + boundary_checks.get("warnings", [])
        if merged_warnings:
            result["warnings"] = merged_warnings
    return result
