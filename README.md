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

FRA Atlas and Web GIS System (Drishti) is a full-stack Forest Rights Act decision support system built for claim intake, claim tracking, admin review, GIS-based visualization, and audit visibility. The application combines a React/Vite frontend with an Express/SQLite backend and a deployed Python OCR/model service for document analysis during claim submission.

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
|   |-- models/
|   |-- python_model/
|   |-- routes/
|   |-- uploads/
|   |-- db.js
|   |-- fra_atlas.db
|   `-- server.js
|-- public/
|-- src/
|   |-- components/
|   |-- config/
|   |-- layouts/
|   |-- pages/
|   |-- services/
|   `-- store/
|-- index.html
|-- package.json
|-- render.yaml
|-- vite.config.js
`-- README.md
```

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
- `backend/routes/auth.js`: registration, login, profile, password endpoints
- `backend/routes/claims.js`: claim CRUD, approval/rejection, document upload, model integration
- `backend/routes/users.js`: admin-only user management
- `backend/routes/alerts.js`: alerts API
- `backend/routes/reports.js`: report endpoints
- `backend/routes/logs.js`: system log access
- `backend/middleware/authMiddleware.js`: JWT auth and admin gate

### Data storage

The project uses a local SQLite database stored at:

- `backend/fra_atlas.db`

The backend creates and updates these tables automatically:

- `users`
- `claims`
- `alerts`
- `reports`
- `system_logs`

Uploaded claim documents are stored in:

- `backend/uploads/claims/<claimId>/`

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
MODEL_ENDPOINT=https://fra-ocr-service.onrender.com/predict
MODEL_TIMEOUT_MS=60000
```

`JWT_SECRET` should always be set explicitly outside local testing.

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

- Predict: `https://fra-ocr-service.onrender.com/predict`
- Health: `https://fra-ocr-service.onrender.com/health`

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
- Returns extraction confidence and duplicate-analysis output

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
7. Model output is saved into the claim record and as `model_result.json` in the claim folder.
8. Admin users can approve or reject claims.
9. Claim actions are logged to `system_logs`.

## Database notes

Useful tables:

- `users`: application users and roles
- `claims`: claim details, polygon JSON, uploaded document paths, model result fields
- `alerts`: alert records
- `reports`: report metadata
- `system_logs`: audits such as login, claim creation, approval, and rejection

The backend performs lightweight SQLite migrations at startup by attempting `ALTER TABLE` statements for newer fields.

## Build and quality status

Current observed status from the repository:

- `npm run build` succeeds
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

## Known limitations

- No automated test suite is configured
- Reports are not fully implemented
- Forgot/reset password flows are placeholders
- Dashboard analytics are mostly static mock data
- OCR/model accuracy depends on document quality and installed OCR dependencies in the deployed service environment
- Lint configuration needs to be split or adjusted for frontend and backend environments

## Suggested next improvements

- Split ESLint config for browser and Node targets
- Replace mocked dashboard data with live API-driven metrics
- Implement real password reset flow
- Replace placeholder report endpoints with persisted report generation
- Add database seed scripts and sample credentials for local demos
- Add automated tests for auth, claims, and admin flows
- Document deployment for production environments

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
