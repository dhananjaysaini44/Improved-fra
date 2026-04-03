# AI Agent Project Context: Drishti FRA Atlas

Welcome, Assistant. This document contains critical contextual knowledge about the `Integrated-fra-fresh` codebase. Prioritize reading this document before engaging in developmental modifications, as it captures key architectural choices, technological constraints, and historical fixes that deviate from standard boilerplates.

## 1. Project Overview
The application is a **Progressive Web App (PWA)** designed to facilitate the submission, management, and auditing of claims under the Forest Rights Act (FRA) in India, particularly for offline or remote usage.
- **Frontend**: React (built with Vite), TailwindCSS, Leaflet.js (for map plotting).
- **Backend**: Node.js, Express.js.
- **Database**: SQLite (local flat file `fra_atlas.db`).

## 2. PWA & Offline-First Strategy
The application operates in highly remote environments with zero connectivity.
- Built using `vite-plugin-pwa` to register service workers.
- Uses IndexedDB (via the `idb` package) to securely queue API payloads (`claimSubmissionQueue`) when offline.
- Intercepts network routes dynamically (`/api/*`) via Workbox `NetworkFirst` fallback strategies.
- Leaflet Maps map-tiles are aggressively cached with a `CacheFirst` strategy so boundaries can be drawn offline.

## 3. The "Shadow Blockchain" Architecture (Algorand)
To ensure the absolute integrity and legal irrevocability of administrative actions (Approve/Reject), the backend implements a "Shadow Blockchain".
- Every time an admin modifies a claim status, the backend computes a cryptographic **SHA-256 Hash** representing the claim's state.
- **Algorand Testnet**: The system fires a 0-ALGO transaction to itself using `algosdk`. The SHA-256 hash is embedded inside the transaction's immutable `Note` byte field.
- **Audit Ledger**: The SQLite database features an `audit_ledger` table bridging local changes with the blockchain. It stores `local_hash` natively and pairs it with `algorand_tx_id` upon network confirmation. 

## 4. Crucial Technological Constraints & Gotchas

> [!WARNING]
> Please adhere to the following rules, as they have been explicitly debugged and stabilized:

**A. Database is Synchronous**
The project abandons traditional async `sqlite3` in favor of `better-sqlite3`. 
- **DO NOT** use `await db.all()` or `await db.run()`.
- **MUST USE** synchronous method chains: `db.prepare('...').run()`, `.all()`, and `.get()`.

**B. Port Discrepancies**
- The **Express Backend** natively spins up on port `3000`.
- The **Vite Frontend** natively assumes port `5000` (strictly configured in `vite.config.js` via `server.port`).
- Vite is set up to automatically proxy frontend `/api` requests from `5000` to `3000`.

**C. Algorand SDK v3 Quirks**
The project uses `algosdk v3.x.x`, which possesses several breaking changes from v2 tutorials:
- `makePaymentTxnWithSuggestedParamsFromObject` strictly requires `sender:` and `receiver:` (it will crash if you use `from:` or `to:`).
- `account.addr` is an Address Object natively, and must be cast explicitly using `account.addr.toString()` before injecting it into transaction objects.
- The returned Raw Transaction object standardizes the ID property entirely lowercase: `sendTx.txid`. Calling `.txId` will return `undefined` and crash confirmation loops.

## 5. Running the Project
- The unified command to run the application is: `npm run dev:all` (calls `concurrently`).
- Valid `.env` secrets must be present in the `backend/` folder, notably `ALGORAND_MNEMONIC="..."` containing an active 25-word keyphrase holding Testnet ALGO.
