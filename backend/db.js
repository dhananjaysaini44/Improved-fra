const path = require('path');
const Database = require('better-sqlite3');

// Always resolve the DB path relative to this file to avoid cwd issues
const dbPath = path.join(__dirname, 'fra_atlas.db');
const db = new Database(dbPath);

// Create audit ledger table for Algorand Shadow Blockchain
db.prepare(`
CREATE TABLE IF NOT EXISTS audit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER,
  action TEXT,
  admin_id INTEGER,
  local_hash TEXT,
  algorand_tx_id TEXT,
  timestamp DATETIME DEFAULT (datetime('now', 'localtime'))
)
`).run();

module.exports = db;
