# OCR Service Deployment

## Local Docker Smoke Test

From `backend/python_model`:

```powershell
docker build -t fra-ocr-service .
docker run --rm -p 8000:8000 fra-ocr-service
```

Health check:

```powershell
curl http://localhost:8000/health
```

## Render Deployment

This repository includes a root-level `render.yaml` blueprint that deploys the OCR service from `backend/python_model`.

Steps:

1. Push the repository to GitHub.
2. In Render, create a new Blueprint and point it at the repo.
3. Render will detect `render.yaml` and create `fra-ocr-service`.
4. After deploy succeeds, copy the service URL.
5. Set `MODEL_ENDPOINT=<service-url>/predict` in the Node backend environment.

## Backend Integration

The Node backend already forwards uploaded claim files to the OCR service and now sends claim candidates in metadata so duplicate detection does not depend on a local SQLite file on Render.

Required backend env var:

```env
MODEL_ENDPOINT=https://your-service.onrender.com/predict
MODEL_TIMEOUT_MS=120000
MODEL_MAX_RETRIES=2
MODEL_RETRY_DELAY_MS=1500
CLAIM_DUPLICATE_WINDOW_SECONDS=120
```

Recommended OCR-service env vars (Render):

```env
TESSERACT_TIMEOUT_SEC=20
PDF_OCR_MAX_PAGES=2
PDF_OCR_DPI=140
OCR_MAX_IMAGE_SIDE=1800
```
