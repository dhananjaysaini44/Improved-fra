const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const db = require('./db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Database setup (shared, absolute path)
// db is imported from ./db

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    name TEXT,
    state TEXT,
    gram_panchayat_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claimant_name TEXT,
    village TEXT,
    state TEXT,
    district TEXT,
    status TEXT DEFAULT 'pending',
    polygon TEXT, -- JSON string of coordinates
    documents TEXT, -- JSON array of file paths
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    severity TEXT,
    message TEXT,
    location TEXT,
    state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    type TEXT,
    data TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- System logs for audits
  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, -- login, claim_created, claim_approved, claim_rejected
    user_id INTEGER,
    entity_type TEXT, -- user, claim
    entity_id INTEGER,
    details TEXT, -- JSON or text description
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

// Ensure missing columns exist (idempotent migrations for SQLite)
try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN village TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN district TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN gram_panchayat_id TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE claims ADD COLUMN rejection_reason TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE claims ADD COLUMN model_result TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE claims ADD COLUMN model_status TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE claims ADD COLUMN model_run_at DATETIME"); } catch (e) {}
try { db.exec("ALTER TABLE alerts ADD COLUMN status TEXT DEFAULT 'active'"); } catch (e) {}
try { db.exec("ALTER TABLE claims ADD COLUMN pipeline_status TEXT DEFAULT 'PENDING'"); } catch (e) {}
try { db.exec("ALTER TABLE claims ADD COLUMN nlp_embedding TEXT"); } catch (e) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gram_panchayat_unique ON users(gram_panchayat_id)"); } catch (e) {}

// Pipeline tables (additive, safe if rerun)
db.exec(`
  CREATE TABLE IF NOT EXISTS ocr_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL,
    doc_filename TEXT NOT NULL,
    extracted_text TEXT,
    structured_json TEXT,
    accuracy REAL,
    fields_complete_ratio REAL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS nlp_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL UNIQUE,
    similarity_score REAL NOT NULL DEFAULT 0.0,
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    flagged_reason TEXT,
    top_matching_claim INTEGER,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    FOREIGN KEY (top_matching_claim) REFERENCES claims(id)
  );

  CREATE TABLE IF NOT EXISTS spatial_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL,
    conflicting_claim_id INTEGER,
    overlap_area REAL,
    conflict_type TEXT,
    is_resolved INTEGER DEFAULT 0,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    FOREIGN KEY (conflicting_claim_id) REFERENCES claims(id)
  );

  CREATE TABLE IF NOT EXISTS confidence_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL UNIQUE,
    ocr_score REAL NOT NULL,
    nlp_score REAL NOT NULL,
    gis_score REAL NOT NULL,
    overall_score REAL NOT NULL,
    is_suspicious INTEGER NOT NULL DEFAULT 0,
    computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS land_parcels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER,
    boundaries_geojson TEXT,
    area REAL,
    land_cover_type TEXT,
    is_restricted INTEGER DEFAULT 0,
    survey_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE SET NULL
  );
`);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/claims', require('./routes/claims'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/logs', require('./routes/logs'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'FRA Atlas Backend is running' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});

module.exports = app;
