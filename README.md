# FRA Atlas and Web GIS System (Drishti)

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)
![Redux](https://img.shields.io/badge/Redux_Toolkit-2-764ABC?logo=redux&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-WebGIS-199900?logo=leaflet&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Remote_OCR_Service-009688?logo=fastapi&logoColor=white)
![Algorand](https://img.shields.io/badge/Algorand-TestNet_Anchoring-000000?logo=algorand&logoColor=white)

FRA Atlas and Web GIS System (Drishti) is a full-stack Forest Rights Act decision support system built for claim intake, claim tracking, admin review, GIS-based visualization, and audit visibility. The application combines a React/Vite frontend with an Express/SQLite backend and a deployed Python OCR/model service for document analysis during claim submission.

The current repository is the active non-fork project lineage (`Improved-fra`). It includes the main application, the deployed OCR/model service source, implementation notes, and supporting architecture documentation generated during development.

## What the project does

The platform is structured around FRA implementation workflows:

- Public landing page with product overview and entry points for login and signup
- User authentication with role-aware access control
- Dashboard with KPI cards, charts, recent activity, and a small map overview
- Claim submission wizard with multi-step data capture, polygon drawing, and document upload
- Claim tracking and admin review flows
- Interactive WebGIS map for exploring submitted claims
- Alerts, reports, and profile management screens
- Admin-only user management and audit visibility

The UI is focused on the states referenced throughout the project:

- Madhya Pradesh
- Tripura
- Odisha
- Telangana

## Tech stack

### Frontend

- React 18
- Vite 7
- React Router
- Redux Toolkit
- React Hook Form
- Tailwind CSS
- Leaflet, React Leaflet, and React Leaflet Draw
- Recharts
- Framer Motion
- Axios

### Backend

- Node.js
- Express 5
- better-sqlite3
- Algorand JavaScript SDK (`algosdk`)
- JSON Web Tokens
- bcryptjs
- multer
- helmet
- cors

### Python OCR/model service

- FastAPI
- Uvicorn

## Repository structure

```text
.
|-- backend/
|   |-- middleware/
|   |   `-- authMiddleware.js
|   |-- models/
|   |   `-- fraSchema.sql
|   |-- python_model/
|   |   |-- ml_pipeline/
|   |   |   |-- db/
|   |   |   |-- models/
|   |   |   `-- stages/
|   |   |-- scripts/
|   |   |-- Dockerfile
|   |   |-- DEPLOYMENT.md
|   |   |-- requirements.txt
|   |   `-- server.py
|   |-- routes/
|   |   |-- alerts.js
|   |   |-- auth.js
|   |   |-- claims.js
|   |   |-- logs.js
|   |   |-- reports.js
|   |   `-- users.js
|   |-- uploads/
|   |-- .env
|   |-- db.js
|   |-- fra_atlas.db
|   |-- package.json
|   `-- server.js
|-- documentation/
|-- dist/
|-- public/
|   `-- drishti-logo.svg
|-- src/
|   |-- components/
|   |-- config/
|   |-- layouts/
|   |-- pages/
|   |-- services/
|   `-- store/
|-- eslint.config.js
|-- index.html
|-- package.json
|-- render.yaml
|-- vite.config.js
`-- README.md
```

The project also contains generated/build/runtime directories such as:

- `dist/`
- `backend/uploads/`
- local SQLite database files
- local editor configuration under `.idea/`

These are part of the current repository state and should be understood when navigating the project, even if they are not all intended for production versioning.

## Application architecture

### Frontend

The frontend is a single-page application served by Vite on port `5000`.

Important frontend files:

- `src/App.jsx`: top-level routes
- `src/layouts/MainLayout.jsx`: authenticated shell, sidebar, header, notifications, theme toggle
- `src/config/api.js`: API base URL selection
- `src/services/*.js`: API integration layer
- `src/store/`: Redux store and auth slice

Primary screens:

- `Landing.jsx`
- `Login.jsx`
- `Signup.jsx`
- `ForgotPassword.jsx`
- `Dashboard.jsx`
- `Map.jsx`
- `ClaimSubmission.jsx`
- `ClaimTracking.jsx`
- `Alerts.jsx`
- `Reports.jsx`
- `Admin.jsx`
- `Profile.jsx`

Static asset:

- `public/drishti-logo.svg` (available at `/drishti-logo.svg`)

### Backend

The backend is an Express API served on port `3000`. It initializes SQLite tables at startup and exposes REST endpoints under `/api/*`.

Important backend files:

- `backend/server.js`: Express app bootstrap, middleware, schema initialization, route registration
- `backend/db.js`: SQLite database connection
- `backend/services/algorand.js`: Algorand TestNet anchoring service for moderation audit hashes
- `backend/utils/hash.js`: SHA-256 hash utility used for audit payload hashing
- `backend/routes/auth.js`: registration, login, profile, password endpoints
- `backend/routes/claims.js`: claim CRUD, approval/rejection, document upload, model integration
- `backend/routes/users.js`: admin-only user management
- `backend/routes/alerts.js`: alerts API
- `backend/routes/reports.js`: report endpoints
- `backend/routes/logs.js`: system log access
- `backend/middleware/authMiddleware.js`: JWT auth and admin gate

Important integration behavior in the backend:

- claim submission uses multipart upload through `POST /api/claims/submit`
- uploaded files are stored under `backend/uploads/claims/<claimId>/`
- when multiple files are submitted, they are archived into a single `documents_bundle.tar.gz` for retained storage
- `model_result.json` is stored alongside the retained claim documents
- the backend calls the remote Python service for both `/predict` and `/pipeline/run`
- remote pipeline output is persisted locally into SQLite tables after the response returns
- model API calls now support retries and configurable timeouts to handle Render cold starts and transient 5xx/429 conditions
- duplicate rapid submissions are blocked within a configurable time window and the recent claim is returned instead of creating extra rows
- pipeline triggering is now skipped when OCR/model inference fails, so `pipeline_status` does not misleadingly appear successful on OCR errors

### Python OCR/model and pipeline service

The Python service is the remote OCR and claim-analysis service deployed on Render.

Important Python service files:

- `backend/python_model/server.py`: FastAPI entrypoint, OCR, `/predict`, `/pipeline/run`, health endpoint, optional API-key enforcement
- `backend/python_model/requirements.txt`: Python runtime dependencies
- `backend/python_model/Dockerfile`: deployment image definition
- `backend/python_model/DEPLOYMENT.md`: deployment notes
- `backend/python_model/ml_pipeline/config.py`: pipeline configuration via environment variables
- `backend/python_model/ml_pipeline/pipeline.py`: pipeline orchestration and scoring
- `backend/python_model/ml_pipeline/db/queries.py`: SQLite helper layer for local DB-mode pipeline execution
- `backend/python_model/ml_pipeline/models/nlp_model.py`: fallback embedding logic and optional transformer path
- `backend/python_model/ml_pipeline/stages/*.py`: OCR, validation, NLP, and GIS stages

### Data storage

The project uses a local SQLite database stored at:

- `backend/fra_atlas.db`

The backend creates and updates these tables automatically:

- `users`
- `claims`
- `alerts`
- `reports`
- `system_logs`
- `ocr_results`
- `nlp_results`
- `spatial_conflicts`
- `confidence_scores`
- `land_parcels`

Uploaded claim documents are stored in:

- `backend/uploads/claims/<claimId>/`

Claim document retention now follows this pattern:

- single document submission: original file + `model_result.json`
- multi-document submission: `documents_bundle.tar.gz` + `model_result.json`

## Running the project locally

### Prerequisites

- Node.js 18+ recommended
- npm
- Python 3.10+ only if you want to run the OCR/model service locally instead of using the deployed endpoint

### 1. Install frontend dependencies

From the repository root:

```powershell
npm.cmd install
```

### 2. Install backend dependencies

From the `backend` directory:

```powershell
cd backend
npm.cmd install
```

### 2.1 Start frontend and backend together from repository root

```powershell
npm.cmd run dev:all
```

Notes:

- Backend runs on `http://localhost:3000`
- Frontend prefers `http://localhost:5000` and automatically uses the next free port if `5000` is busy

### 3. Configure backend environment

Create `backend/.env` from `backend/.env.example`.

Example:

```env
JWT_SECRET=replace-with-a-strong-secret
PORT=3000
NODE_ENV=development
MODEL_ENDPOINT=https://improved-fra.onrender.com/predict
MODEL_TIMEOUT_MS=180000
MODEL_MAX_RETRIES=2
MODEL_RETRY_DELAY_MS=1500
CLAIM_DUPLICATE_WINDOW_SECONDS=120
MODEL_API_KEY=copy-from-render-if-enabled
ALGORAND_MNEMONIC=your-25-word-mnemonic-for-testnet-anchoring
```

`JWT_SECRET` should always be set explicitly outside local testing.
If `MODEL_API_KEY` is set both locally and on Render, the backend will authenticate its requests to the Python service using the `x-api-key` header.

### 4. Start the backend

```powershell
cd backend
npm.cmd run dev
```

Backend URL:

- `http://localhost:3000`

Health endpoint:

- `http://localhost:3000/api/health`

### 5. Start the frontend

From the repository root in a separate terminal:

```powershell
npm.cmd run dev
```

Frontend URL:

- `http://localhost:5000`

The Vite dev server proxies `/api` requests to `http://localhost:3000`.

## Deployed Python model service

Claim submission calls a deployed OCR/model API hosted on Render.

Current deployed endpoints:

- Predict: `https://improved-fra.onrender.com/predict`
- Health: `https://improved-fra.onrender.com/health`
- Pipeline: `https://improved-fra.onrender.com/pipeline/run`

Service location in repository:

- `backend/python_model/server.py`
- `backend/python_model/Dockerfile`
- `backend/python_model/DEPLOYMENT.md`
- `render.yaml`

What the service does now:

- Accepts multiple uploaded files under `documents`
- Accepts JSON metadata from backend (including current claim data and existing claim candidates)
- Performs OCR for images and PDFs (with dependency-aware fallback behavior)
- Extracts structured FRA fields from OCR text
- Runs duplicate detection against claim candidates supplied by the backend
- Runs an additive post-submit ML pipeline for validation, NLP similarity, GIS overlap checks, and confidence scoring
- Performs bounded OCR to stay reliable under free-tier constraints (image downscaling, per-call OCR timeout, and capped PDF OCR pages/DPI)
- Returns extraction confidence and duplicate-analysis output

Security and deployment notes:

- `/health` remains open for deployment and readiness checks
- `/predict` and `/pipeline/run` support optional API-key verification through `MODEL_API_KEY`
- the deployed service currently uses a lightweight fallback NLP backend to stay within Render free-tier memory limits
- OCR/PDF libraries are imported lazily in the Python service to reduce startup memory usage
- recommended OCR runtime envs on Render:
  - `TESSERACT_TIMEOUT_SEC=20`
  - `PDF_OCR_MAX_PAGES=2`
  - `PDF_OCR_DPI=140`
  - `OCR_MAX_IMAGE_SIDE=1800`

The frontend does not call the Python service directly. The backend calls it server-to-server during `POST /api/claims/submit`.

## Frontend routes

### Public routes

- `/`
- `/login`
- `/signup`
- `/forgot-password`

### Protected routes

- `/dashboard`
- `/map`
- `/claim-submission`
- `/claim-tracking`
- `/alerts`
- `/reports`
- `/profile`

### Admin-only route

- `/admin`

## Backend API overview

### Authentication

Base path: `/api/auth`

- `POST /register`
- `POST /login`
- `GET /me`
- `PUT /profile`
- `PUT /change-password`
- `POST /forgot-password`
- `POST /reset-password`

### Claims

Base path: `/api/claims`

- `GET /`
- `POST /`
- `GET /:id`
- `PUT /:id`
- `DELETE /:id`
- `GET /stats/summary`
- `POST /:id/approve`
- `POST /:id/reject`
- `POST /submit`

`POST /submit` also supports duplicate-submit protection; when triggered, it returns the recent existing claim payload with `duplicate_submission_blocked: true`.

### Alerts

Base path: `/api/alerts`

- CRUD-style alert endpoints are exposed from the backend alerts route

### Reports

Base path: `/api/reports`

- `GET /`
- `POST /`
- `GET /:id`
- `PUT /:id`
- `DELETE /:id`

The current reports implementation is a mock placeholder.

### Users

Base path: `/api/users`

- `GET /`
- `GET /:id`
- `POST /`
- `PUT /:id`
- `DELETE /:id`

These routes require admin access.

### Logs

Base path: `/api/logs`

- Log endpoints expose system audit records such as login and claim actions

### Health

- `GET /api/health`

## Authentication and authorization

The project uses JWT-based authentication.

- Tokens are issued on login
- Protected frontend routes are wrapped with route guards
- Admin-only functionality is separated both in the UI and backend middleware
- Login events and claim actions are written to `system_logs`

The backend currently includes a fallback JWT secret in code. That is acceptable only for development and should be removed or overridden in any real deployment.

## Claim workflow

The implemented claim flow looks like this:

1. A user fills out the multi-step claim submission form.
2. The user draws the claimed area on a Leaflet map.
3. Supporting documents are uploaded.
4. The backend creates the claim record in SQLite.
5. Uploaded files are moved to a permanent claim-specific folder.
6. The backend sends documents and metadata to the deployed Python OCR/model service.
7. OCR/model output is saved into the claim record and as `model_result.json` in the claim folder.
8. The backend triggers a non-blocking remote pipeline run for validation, NLP similarity, GIS conflict checks, and scoring.
9. Remote pipeline results are persisted locally into SQLite pipeline tables.
10. Admin users can approve or reject claims.
11. Approve/reject events generate local SHA-256 hashes and attempt Algorand anchoring.
12. Claim, pipeline, and moderation actions are logged to `system_logs`, with blockchain audit rows in `audit_ledger`.

## Database notes

Useful tables:

- `users`: application users and roles
- `claims`: claim details, polygon JSON, uploaded document paths, model result fields, and pipeline status
- `alerts`: alert records
- `reports`: report metadata
- `system_logs`: audits such as login, claim creation, approval, rejection, and pipeline activity
- `ocr_results`: OCR-stage persistence for DB-mode pipeline execution
- `nlp_results`: duplicate and similarity results
- `spatial_conflicts`: polygon overlap results
- `confidence_scores`: OCR, NLP, GIS, and overall claim scoring
- `land_parcels`: GIS-support table introduced for pipeline expansion
- `audit_ledger`: blockchain shadow-audit table for approve/reject events with local hash and optional Algorand tx id

The backend performs lightweight SQLite migrations at startup by attempting `ALTER TABLE` statements for newer fields.

## Blockchain audit integration (Algorand)

The backend includes a blockchain shadow-audit path for moderation actions:

- on `POST /api/claims/:id/approve` and `POST /api/claims/:id/reject`, the backend:
  - generates a SHA-256 hash of the moderation payload
  - attempts to anchor that hash to Algorand TestNet
  - stores both local hash and Algorand tx id in `audit_ledger`
- if Algorand anchoring fails, claim moderation still succeeds and the failure is handled gracefully

Runtime notes:

- set `ALGORAND_MNEMONIC` for live anchoring
- if mnemonic is missing/placeholder, anchoring is skipped and app flow continues

## Build and quality status

Current observed status from the repository:

- `npm run build` succeeds
- `cd backend && npm test` succeeds (pipeline read-model regression)
- `npm run lint` currently fails

Main reasons lint fails:

- ESLint is scanning the CommonJS backend with rules configured for frontend/browser-style globals
- Some frontend files contain unused variables and a missing hook dependency warning

Additional build/runtime notes:

- The main frontend bundle is large and triggers a Vite chunk-size warning
- `react-leaflet-draw` emits a build warning related to a `leaflet-draw` export
- Reports endpoints are placeholders
- Password reset endpoints are placeholders
- Some dashboard and activity data are still mocked in the frontend
- The Python model service is deployed remotely and is intended to be called from the backend, not directly from the frontend

## Known limitations

- No automated test suite is configured
- Reports are not fully implemented
- Forgot/reset password flows are placeholders
- Dashboard analytics are mostly static mock data
- OCR/model accuracy depends on document quality and installed OCR dependencies in the deployed service environment
- The deployed Python service must stay within Render free-tier memory limits, so the NLP backend is intentionally lightweight
- Lint configuration needs to be split or adjusted for frontend and backend environments

## Suggested next improvements

- Split ESLint config for browser and Node targets
- Replace mocked dashboard data with live API-driven metrics
- Implement real password reset flow
- Replace placeholder report endpoints with persisted report generation
- Add database seed scripts and sample credentials for local demos
- Add automated tests for auth, claims, and admin flows
- Document deployment for production environments
- Separate tracked source documentation from runtime artifacts and editor-specific files
- Add dedicated endpoints or UI views for inspecting pipeline results

## Supporting documentation in the repository

The repository also contains supporting PDFs, diagrams, and internal working notes.

Documentation folder:

- `documentation/` contains PDFs, diagrams, architecture exports, sequence diagrams, use-case diagrams, class diagrams, and deployment visuals

Project working notes currently present at the root:

- `todo.md`

These files are useful for implementation continuity and project handoff, even when they are not directly used by the running application.

## Useful commands

### Frontend

```powershell
npm.cmd run dev
npm.cmd run dev:frontend
npm.cmd run dev:all
npm.cmd run build
npm.cmd run lint
npm.cmd run preview
```

### Backend

```powershell
cd backend
npm.cmd run dev
npm.cmd start
```

From repository root:

```powershell
npm.cmd run dev:backend
```
