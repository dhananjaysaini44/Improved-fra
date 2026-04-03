# Agent Prompt - Enhanced OCR Field Extraction for Spatial Document Analysis
# FRA Atlas / Drishti | Repository: Improved-fra | Date: April 3, 2026

---

## Your task

Extend the current OCR and pipeline extraction logic so the system can extract additional spatial identifiers from FRA claim documents.

The goal is not to redesign the OCR system.
The goal is to make the current OCR result more useful for admins and for later GIS verification.

These additional fields should help locate a parcel on a map even when exact GPS coordinates are absent, unclear, or disputed.

---

## Read this first: current code reality

This repository already has two OCR/analysis paths:

### Path 1 - `/predict` in the Python service

File:

- `backend/python_model/server.py`

Endpoint:

- `POST /predict`

This is the synchronous OCR path used during claim submission.
It currently:

- accepts multipart `documents`
- accepts `metadata` as JSON string
- extracts text
- extracts structured fields
- runs duplicate analysis
- returns OCR/model output immediately

The backend stores that result in:

- `claims.model_result`
- `backend/uploads/claims/<claimId>/model_result.json`

### Path 2 - `/pipeline/run` in the Python service

Files:

- `backend/python_model/server.py`
- `backend/python_model/ml_pipeline/`

Endpoint:

- `POST /pipeline/run`

This is the asynchronous pipeline path triggered by the Node backend after `/predict`.
It currently computes:

- validation completeness
- NLP similarity
- GIS overlap diagnostics
- combined score

### Node backend integration

File:

- `backend/routes/claims.js`

Current behavior:

- `/api/claims/submit` calls `/predict`
- stores the full OCR result in the DB
- then triggers `/pipeline/run` in fire-and-forget mode
- pipeline failure must not break claim submission

This is a hard rule. Do not break it.

---

## Important correction: current code does not use the helper names from the old plan

The older extraction plan referenced `_extract_fields()` and `_parse_fields()`.
Those names do **not** match the current repo.

Current extraction entrypoints are:

- in `backend/python_model/server.py`
  - `FIELD_PATTERNS`
  - `extract_structured_fields(text, metadata)`
  - `build_document_result(...)`
  - `merge_document_results(...)`

- in `backend/python_model/ml_pipeline/stages/ocr_stage.py`
  - there is currently **no** mirrored rich field parser
  - this file currently does basic byte reading and writes placeholder `structured_fields`

So this task must be implemented against the real code, not the older naming.

---

## The change you are making

Add richer spatial field extraction so the OCR output can provide more map-relevant identifiers.

These fields should appear inside the OCR structured field output.

### Fields to add

Priority order:

| Field | Why it matters |
|---|---|
| `survey_number` | Precise parcel locator within village/district |
| `khata_number` | Ownership or land-record linkage |
| `hissa_number` | Parcel subdivision identifier |
| `forest_compartment` | Spatial forest unit |
| `forest_beat` | Sub-unit under forest administration |
| `forest_range` | Broader forest administrative anchor |
| `boundary_north` | Relative parcel context |
| `boundary_south` | Relative parcel context |
| `boundary_east` | Relative parcel context |
| `boundary_west` | Relative parcel context |
| `land_area_ha` | Polygon area cross-check |
| `gram_panchayat` | Stronger sub-village administrative anchor |
| `pin_code` | Broad location anchor |
| `photo_exif_lat` | Optional image GPS latitude |
| `photo_exif_lon` | Optional image GPS longitude |

Additional note:

- the current code already has `gram_panchayat`
- the current code uses `tehsil_taluka` instead of plain `taluk`
- do not remove or rename `tehsil_taluka`

---

## Where to make changes

### Change 1 - `backend/python_model/server.py`

This is the primary OCR result path used by the backend today.

You should:

1. extend `FIELD_PATTERNS`
2. extend `extract_structured_fields(...)`
3. add EXIF GPS extraction during document processing

Do **not**:

- rename current top-level result keys
- remove current fields
- change `/predict` request contract

The current `/predict` response shape includes:

- `summary`
- `metadata`
- `documents`
- `ocr_text`
- `extracted_fields`
- `duplicate_analysis`
- `extraction_confidence`
- `service_readiness`
- `run_at`
- `model_version`

These top-level keys must remain stable.

### Change 2 - `backend/python_model/ml_pipeline/stages/ocr_stage.py`

This file currently does not mirror the richer extraction logic from `server.py`.

The task here is not just to add one regex.
It needs to be upgraded so the pipeline OCR stage can also expose structured fields in a useful way.

Target outcome:

- OCR stage should populate meaningful `structured_fields`
- new spatial fields should also be available in pipeline state

Do **not**:

- add the new spatial fields to any required-field completeness metric unless the current code is explicitly designed for that

Current reality:

- there is no `REQUIRED_FIELDS` list in this file right now
- if completeness scoring is introduced later, the new spatial fields should still remain supplementary, not mandatory

### Change 3 - `backend/python_model/ml_pipeline/stages/gis_stage.py`

Add an area cross-check using OCR-extracted `land_area_ha` and the submitted polygon.

Desired behavior:

- if both polygon and `land_area_ha` exist, compute an approximate discrepancy ratio
- store a diagnostic such as `area_discrepancy_ratio`
- add warnings if discrepancy is large

Do **not**:

- change the existing `gis_score` formula unless explicitly required

This should be diagnostic, not a scoring rewrite.

### Change 4 - `backend/routes/claims.js`

This file should usually not need changes for the new OCR fields.

Why:

- it already stores the full `modelResult` with `JSON.stringify(modelResult)`
- it does not cherry-pick OCR keys before persistence

So this file should be treated as **verify-only** unless a real reason appears.

---

## EXIF extraction rules

If the source document is a JPEG or image upload:

- attempt to read EXIF GPS data using Pillow
- do not add a new package for this
- do not introduce `piexif`
- if EXIF is missing, return `None` values
- never fail OCR just because EXIF is missing

Preferred approach:

- use `PIL.Image`
- use `_getexif()` or the Pillow EXIF access available in the installed version
- convert DMS to decimal degrees

Store results as:

- `photo_exif_lat`
- `photo_exif_lon`

---

## Render and deployment constraints

The Python service runs on Render free tier.
That means memory and startup cost are tight constraints.

Hard rules:

1. do not add any new packages to `backend/python_model/requirements.txt`
2. do not add heavy ML/model libraries
3. do not add top-level imports of heavy OCR/PDF/image libraries
4. keep lazy import patterns intact where possible
5. do not alter `render.yaml` for this task

Current deployment strategy already assumes:

- `NLP_BACKEND=fallback`
- lazy OCR/PDF imports
- lightweight deployment footprint

Do not break that.

---

## Invariants that must not break

- `POST /api/claims/submit` must still succeed even if OCR or pipeline extraction partially fails
- `/predict` top-level response keys must remain stable
- `claims.model_result` must remain a valid JSON string
- `model_result.json` must still be written
- `pipeline_status` flow must continue working
- admin UI compatibility with existing `model_result` structure must be preserved

---

## Recommended implementation approach

### Part A - Extend OCR field patterns in `server.py`

Add the new fields to `FIELD_PATTERNS`.

Suggested additions:

```python
"survey_number": [
    r"Survey(?: No| Number)?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
    r"S\\.\\s*No\\.?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
],
"khata_number": [
    r"Khata(?: No| Number)?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
    r"Khatha(?: No| Number)?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
    r"Patta(?: No| Number)?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
],
"hissa_number": [
    r"Hissa(?: No| Number)?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,20})",
    r"Sub(?:division)?\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,20})",
],
"forest_compartment": [
    r"Compartment\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
    r"Comp\\.\\s*[:#\\-]?\\s*([0-9A-Za-z/\\-]{1,30})",
],
"forest_beat": [
    r"Beat\\s*[:#\\-]?\\s*([A-Za-z0-9\\s\\-]{2,40})",
],
"forest_range": [
    r"Range\\s*[:#\\-]?\\s*([A-Za-z0-9\\s\\-]{2,40})",
],
"boundary_north": [
    r"North\\s*[:\\-]\\s*(.+?)(?=\\n|South|East|West|$)",
],
"boundary_south": [
    r"South\\s*[:\\-]\\s*(.+?)(?=\\n|North|East|West|$)",
],
"boundary_east": [
    r"East\\s*[:\\-]\\s*(.+?)(?=\\n|North|South|West|$)",
],
"boundary_west": [
    r"West\\s*[:\\-]\\s*(.+?)(?=\\n|North|South|East|$)",
],
"land_area_ha": [
    r"([0-9]+(?:\\.[0-9]+)?)\\s*(?:hectare|hectares|ha\\b)",
],
"pin_code": [
    r"\\b([1-9][0-9]{5})\\b",
],
```

These patterns should be additive.
Do not delete existing field support.

### Part B - Add EXIF GPS extraction in `server.py`

Best insertion point:

- inside `build_document_result(...)`
- after document text extraction
- only for image-like uploads

Result:

- merge `photo_exif_lat` and `photo_exif_lon` into `structured_fields`

### Part C - Upgrade pipeline OCR stage

`backend/python_model/ml_pipeline/stages/ocr_stage.py` currently only decodes bytes and writes empty `structured_fields`.

A proper implementation should:

- reuse or mirror structured field extraction logic
- remain compatible with bundled archives (`documents_bundle.tar.gz`)
- expose the new spatial fields in pipeline OCR results

This is the main place where the old prompt was incomplete.

### Part D - Add GIS diagnostic area check

In `gis_stage.py`, after overlap checks:

- read OCR `land_area_ha` if available
- compute polygon area in approximate hectares
- calculate discrepancy ratio
- store:
  - `area_discrepancy_ratio`
  - optional `warnings`

Do not turn this into a hard failure.

---

## What to verify after implementation

1. submit a claim with an image
   - EXIF coordinates should appear if the image contains GPS EXIF
   - if not, `photo_exif_lat` and `photo_exif_lon` should be `None`

2. submit a claim with a PDF
   - new fields should appear under `extracted_fields`
   - null is acceptable if the document does not contain recognizable values

3. confirm `claims.model_result` still stores the full OCR result

4. confirm `model_result.json` still writes normally

5. confirm pipeline execution still completes without breaking claim submission

6. confirm GIS stage adds `area_discrepancy_ratio` when polygon and OCR area are both available

7. confirm Render `/health` still works after deployment

8. confirm no new dependency was added

---

## Files that should be touched

Primary expected files:

- `backend/python_model/server.py`
- `backend/python_model/ml_pipeline/stages/ocr_stage.py`
- `backend/python_model/ml_pipeline/stages/gis_stage.py`

Verify-only file:

- `backend/routes/claims.js`

Do not touch unless absolutely required:

- `backend/server.js`
- `backend/db.js`
- `backend/middleware/authMiddleware.js`
- `backend/python_model/requirements.txt`
- `backend/python_model/ml_pipeline/config.py`
- `backend/python_model/ml_pipeline/pipeline.py`
- `src/`
- `render.yaml`

---

## Final instruction

Implement the feature against the code that actually exists in `Improved-fra`, not the older imagined helper layout.

That means:

- extend the current field extraction system
- do not redesign the API
- do not add packages
- do not disturb deployment safety
- keep OCR and pipeline outputs compatible with the existing backend and admin UI
