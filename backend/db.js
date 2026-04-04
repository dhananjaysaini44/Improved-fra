const path = require('path');
const Database = require('better-sqlite3');

// Always resolve the DB path relative to this file to avoid cwd issues
const dbPath = path.join(__dirname, 'fra_atlas.db');
const db = new Database(dbPath);

// 1. Create Core Tables
db.exec(`
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claimant_name TEXT NOT NULL,
  village TEXT NOT NULL,
  state TEXT NOT NULL,
  district TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  polygon TEXT,
  documents TEXT,
  user_id INTEGER,
  model_result TEXT,
  model_status TEXT,
  model_run_at DATETIME,
  rejection_reason TEXT,
  created_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS audit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER,
  action TEXT,
  admin_id INTEGER,
  local_hash TEXT,
  algorand_tx_id TEXT,
  timestamp DATETIME DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT,
  user_id INTEGER,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT,
  timestamp DATETIME DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS khasra_plots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  khasra_no TEXT NOT NULL,
  khata_no TEXT,
  village_code TEXT NOT NULL,
  tehsil_code TEXT NOT NULL,
  district_code TEXT NOT NULL,
  state TEXT NOT NULL,
  area_hectares REAL,
  polygon TEXT,
  claimed_by INTEGER,
  UNIQUE(khasra_no, village_code)
);

CREATE TABLE IF NOT EXISTS location_hierarchy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state_code TEXT NOT NULL,
  state_name TEXT NOT NULL,
  district_code TEXT NOT NULL,
  district_name TEXT NOT NULL,
  tehsil_code TEXT NOT NULL,
  tehsil_name TEXT NOT NULL,
  village_code TEXT NOT NULL,
  village_name TEXT NOT NULL,
  UNIQUE(village_code, tehsil_code)
);
`);

// 2. Claims Table Schema Updates (Idempotent Migrations)
const migrations = [
  "ALTER TABLE claims ADD COLUMN khasra_no TEXT",
  "ALTER TABLE claims ADD COLUMN khata_no TEXT",
  "ALTER TABLE claims ADD COLUMN village_code TEXT",
  "ALTER TABLE claims ADD COLUMN tehsil_code TEXT",
  "ALTER TABLE claims ADD COLUMN patwari_name TEXT",
  "ALTER TABLE claims ADD COLUMN patwari_verified INTEGER DEFAULT 0",
  "ALTER TABLE claims ADD COLUMN land_area_hectares REAL",
  "ALTER TABLE claims ADD COLUMN has_conflict INTEGER DEFAULT 0",
  "ALTER TABLE claims ADD COLUMN conflict_reason TEXT",
  "ALTER TABLE claims ADD COLUMN conflicting_claim_id INTEGER"
];

migrations.forEach(m => {
  try { db.exec(m); } catch (e) { /* Column likely exists */ }
});

// 3. Seed Location Hierarchy
const seedData = [
  ['MP', 'Madhya Pradesh', '454', 'Mandla', '03816', 'Niwas', '495392', 'Ghughri'],
  ['MP', 'Madhya Pradesh', '454', 'Mandla', '03816', 'Niwas', '495393', 'Bamhni'],
  ['MP', 'Madhya Pradesh', '454', 'Mandla', '03817', 'Mandla', '495444', 'Sijhora'],
  ['MP', 'Madhya Pradesh', '454', 'Dindori', '03818', 'Dindori', '495555', 'Samnapur'],
  ['OR', 'Odisha', '396', 'Koraput', '03287', 'Jeypore', '428512', 'Kundra'],
  ['OR', 'Odisha', '396', 'Koraput', '03287', 'Jeypore', '428513', 'Borigumma'],
  ['OR', 'Odisha', '396', 'Koraput', '03288', 'Koraput', '428600', 'Sunabeda'],
  ['OR', 'Odisha', '389', 'Kandhamal', '03100', 'Phulbani', '421000', 'Daringbadi'],
  ['TR', 'Tripura', '461', 'West Tripura', '03924', 'Mohanpur', '502311', 'Champaknagar'],
  ['TR', 'Tripura', '461', 'West Tripura', '03924', 'Mohanpur', '502312', 'Melaghar'],
  ['TR', 'Tripura', '461', 'West Tripura', '03925', 'Jirania', '502400', 'Khowai'],
  ['TS', 'Telangana', '538', 'Bhadradri Kothagudem', '04601', 'Bhadrachalam', '574211', 'Kinnerasani'],
  ['TS', 'Telangana', '538', 'Bhadradri Kothagudem', '04601', 'Bhadrachalam', '574212', 'Paloncha'],
  ['TS', 'Telangana', '538', 'Bhadradri Kothagudem', '04602', 'Kothagudem', '574300', 'Yellandu'],
  ['TS', 'Telangana', '532', 'Adilabad', '04500', 'Utnoor', '570000', 'Indervelly']
];

const insertLocation = db.prepare(`
  INSERT OR IGNORE INTO location_hierarchy 
  (state_code, state_name, district_code, district_name, tehsil_code, tehsil_name, village_code, village_name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

seedData.forEach(row => {
  try {
    insertLocation.run(...row);
  } catch (err) {
    console.error('Seeding error for:', row, err.message);
  }
});

// 4. Data Normalization
try {
  db.exec(`
    UPDATE claims SET state = 'Madhya Pradesh' WHERE state IN ('MP', 'Madhyapradesh');
    UPDATE claims SET state = 'Odisha' WHERE state IN ('OD', 'OR', 'Orissa');
    UPDATE claims SET state = 'Tripura' WHERE state IN ('TR', 'tripura');
    UPDATE claims SET state = 'Telangana' WHERE state IN ('TS', 'TL', 'telangana');
  `);
} catch (e) { /* best effort */ }

console.log('Database initialized successfully with spatial and metadata tables.');

module.exports = db;
