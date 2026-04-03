# AI Agent Project Guide: Drishti FRA Atlas

This document is the "Source of Truth" for any AI agent working on the `Integrated-fra-fresh` codebase. It contains critical architectural context, technical constraints, and coding standards that deviate from common patterns.

---

## 1. Project Core Identity
- **Name**: Drishti FRA Atlas
- **Purpose**: A Decision Support System for the Forest Rights Act (FRA) in India.
- **Key Features**: Claim intake (wizard), WebGIS map (Leaflet), Admin review, Offline-first PWA, Shadow Blockchain (Algorand), and Python-based OCR/Analysis.
- **Target States**: Madhya Pradesh, Tripura, Odisha, Telangana.

## 2. Technical Stack
- **Frontend**: React 18, Vite 7, Tailwind CSS, Redux Toolkit, Leaflet.js.
- **Backend**: Node.js, Express 5.
- **Database**: SQLite (file-based: `backend/fra_atlas.db`) using `better-sqlite3`.
- **Blockchain**: Algorand (Testnet) for immutable audit anchoring.
- **AI/ML**: FastAPI-based Python service for OCR and duplicate detection.

---

## 3. ⚠️ CRITICAL "GOLDEN RULES" (Read or You Will Break Stuff)

### A. SQLite is SYNCHRONOUS
The project uses `better-sqlite3`, which is **not asynchronous**.
- **DO NOT** use `await` with database calls.
- **DO NOT** use `db.all()`, `db.get()`, or `db.run()` as promises.
- **CORRECT**: `const row = db.prepare('SELECT...').get();`
- **INCORRECT**: `const row = await db.prepare('SELECT...').get();`

### B. Network & Ports
- **Backend**: Native port `3000`.
- **Frontend**: Native port `5000` (configured in `vite.config.js`).
- **Proxy**: Vite is configured to proxy `/api` requests from `5000` to `3000`. 
- **Unified Run**: Use `npm run dev:all` to start both.

### C. Algorand SDK v3 Quirks
The project uses `algosdk v3.x.x`. It has breaking changes from v2:
- Use `sender:` and `receiver:` (NOT `from:`/`to:`).
- `account.addr` must be cast: `account.addr.toString()`.
- Transaction ID is lowercase: `sendTx.txid` (NOT `txId`).

---

## 4. Key Logic & Architectures

### The "Shadow Blockchain" (Algorand Anchoring)
When an admin approves/rejects a claim:
1. A SHA-256 hash of the claim state is generated.
2. A 0-ALGO transaction is sent to the Algorand Testnet.
3. The hash is stored in the transaction's `Note` field.
4. The `algorand_tx_id` is saved back to the `audit_ledger` table.

### Python Model Integration
During claim submission (`POST /api/claims/submit`):
1. Documents are uploaded to `backend/uploads/claims/<id>/`.
2. The backend calls the Python FastAPI service (`/predict`).
3. The model returns OCR data and duplicate detection results.
4. Results are stored in the `claims` table (`model_result` JSON column).

---

## 5. Database Schema (Schema Reference)

### `users`
- `id`, `email` (unique), `password`, `role` (`user`, `admin`), `name`, `state`, `gram_panchayat_id` (unique), `village`, `district`, `phone`.

### `claims`
- `id`, `claimant_name`, `village`, `state`, `district`, `status` (`pending`, `approved`, `rejected`), `polygon` (JSON coordinates), `documents` (JSON paths), `user_id`, `rejection_reason`, `model_result` (JSON), `model_status`, `model_run_at`.

### `audit_ledger`
- `id`, `claim_id`, `action`, `admin_id`, `local_hash`, `algorand_tx_id`, `timestamp`.

### `system_logs`
- `id`, `action`, `user_id`, `entity_type`, `entity_id`, `details` (JSON), `created_at`.

---

## 6. Directory Map
- `/src`: React Frontend code.
  - `/pages`: Main screens (Dashboard, Map, etc.).
  - `/services`: API client logic (Axios).
- `/backend`: Node.js Backend code.
  - `/routes`: API endpoints.
  - `/services/algorand.js`: Blockchain logic.
  - `/python_model`: FastAPI service code.
- `/public`: Static assets (Logos, icons).

---

## 7. How to contribute
1. Run `npm run dev:all` at root.
2. Check `backend/.env` for Algosdk mnemonics.
3. Follow the synchronous DB pattern in all backend routes.
4. Use Tailwind for UI and keep it premium/modern.
