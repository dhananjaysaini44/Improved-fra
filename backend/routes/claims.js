const express = require('express');
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Ensure uploads directory exists
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_ROOT)) {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

// Multer setup: store initial uploads in a temp folder per request, then move to claim folder after ID is known
const tempDir = path.join(UPLOADS_ROOT, 'tmp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
const upload = multer({ dest: tempDir });

// Call local Python model API with given files and payload
async function callModelAPI(files, payload) {
  const endpoint = process.env.MODEL_ENDPOINT || 'http://127.0.0.1:8000/predict';
  const form = new FormData();
  // append files under field name 'documents'
  files.forEach((filePath) => {
    const stream = fs.createReadStream(filePath);
    form.append('documents', stream, path.basename(filePath));
  });
  // include optional payload as JSON string
  form.append('metadata', JSON.stringify(payload || {}));

  const headers = form.getHeaders();
  const timeout = Number(process.env.MODEL_TIMEOUT_MS || 60000);
  const response = await axios.post(endpoint, form, { headers, timeout, maxContentLength: Infinity, maxBodyLength: Infinity });
  return response.data;
}

function buildModelCandidates(currentClaimId) {
  const rows = db.prepare(`
    SELECT id, claimant_name, village, district, state, status, model_result, created_at
    FROM claims
    WHERE (? IS NULL OR id <> ?)
    ORDER BY created_at DESC
  `).all(currentClaimId ?? null, currentClaimId ?? null);

  return rows.map((row) => ({
    id: row.id,
    claimant_name: row.claimant_name,
    village: row.village,
    district: row.district,
    state: row.state,
    status: row.status,
    model_result: row.model_result,
    created_at: row.created_at,
  }));
}

// Get all claims with optional filters
router.get('/', (req, res) => {
  try {
    const { status, state, search } = req.query;
    let query = 'SELECT * FROM claims';
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (state) {
      conditions.push('state = ?');
      params.push(state);
    }

    if (search) {
      conditions.push('(claimant_name LIKE ? OR village LIKE ? OR district LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const stmt = db.prepare(query);
    const claims = stmt.all(...params);
    
    res.json(claims);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Create new claim (JSON only, legacy)
router.post('/', (req, res) => {
  try {
    const { claimant_name, village, state, district, polygon, documents, user_id } = req.body;
    
    if (!claimant_name || !village || !state || !district) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const stmt = db.prepare(`
      INSERT INTO claims (claimant_name, village, state, district, polygon, documents, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const info = stmt.run(
      claimant_name,
      village,
      state,
      district,
      JSON.stringify(polygon || []),
      JSON.stringify(documents || []),
      user_id
    );

    const newClaim = db.prepare('SELECT * FROM claims WHERE id = ?').get(info.lastInsertRowid);

    // Log claim creation
    try {
      db.prepare(`
        INSERT INTO system_logs (action, user_id, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run('claim_created', user_id || null, 'claim', newClaim.id, JSON.stringify({ claimant_name, state, district }));
    } catch (e) { /* best-effort logging */ }

    res.status(201).json(newClaim);
  } catch (error) {
    res.status(500).json({ message: 'Error creating claim', error: error.message });
  }
});

// Get claim by ID
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('SELECT * FROM claims WHERE id = ?');
    const claim = stmt.get(id);
    
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    res.json(claim);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching claim', error: error.message });
  }
});

// Update claim
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { claimant_name, village, state, district, status, polygon, documents, actor_user_id, rejection_reason } = req.body;
    
    // If status is rejected, require a rejection reason
    if (status === 'rejected' && (!rejection_reason || !String(rejection_reason).trim())) {
      return res.status(400).json({ message: 'Rejection reason is required when rejecting a claim' });
    }

    const stmt = db.prepare(`
      UPDATE claims 
      SET claimant_name = ?, village = ?, state = ?, district = ?, status = ?, polygon = ?, documents = ?, rejection_reason = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END
      WHERE id = ?
    `);
    
    const info = stmt.run(
      claimant_name,
      village,
      state,
      district,
      status,
      JSON.stringify(polygon || []),
      JSON.stringify(documents || []),
      status || null,
      status === 'rejected' ? String(rejection_reason).trim() : null,
      id
    );

    if (info.changes === 0) {
      return res.status(404).json({ message: 'Claim not found' });
    }

    const updatedClaim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);

    // If status changed to approved/rejected, log it
    try {
      if (status === 'approved' || status === 'rejected') {
        db.prepare(`
          INSERT INTO system_logs (action, user_id, entity_type, entity_id, details)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          status === 'approved' ? 'claim_approved' : 'claim_rejected',
          actor_user_id || null,
          'claim',
          id,
          JSON.stringify({ status, rejection_reason: status === 'rejected' ? String(rejection_reason).trim() : null })
        );
      }
    } catch (e) { /* best-effort logging */ }

    res.json(updatedClaim);
  } catch (error) {
    res.status(500).json({ message: 'Error updating claim', error: error.message });
  }
});

// Delete claim
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('DELETE FROM claims WHERE id = ?');
    const info = stmt.run(id);
    
    if (info.changes === 0) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    res.json({ message: 'Claim deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting claim', error: error.message });
  }
});

// Get claim statistics
router.get('/stats/summary', (req, res, next) => {
  console.log('DEBUG: /stats/summary hit');
  try {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM claims').get();
    const totalClaims = totalStmt ? totalStmt.count : 0;
    const pendingStmt = db.prepare('SELECT COUNT(*) as count FROM claims WHERE status = ?').get('pending');
    const pendingClaims = pendingStmt ? pendingStmt.count : 0;
    const approvedStmt = db.prepare('SELECT COUNT(*) as count FROM claims WHERE status = ?').get('approved');
    const approvedClaims = approvedStmt ? approvedStmt.count : 0;
    const rejectedStmt = db.prepare('SELECT COUNT(*) as count FROM claims WHERE status = ?').get('rejected');
    const rejectedClaims = rejectedStmt ? rejectedStmt.count : 0;
    res.json({
      total: totalClaims,
      pending: pendingClaims,
      approved: approvedClaims,
      rejected: rejectedClaims
    });
  } catch (error) {
    console.error('DEBUG: stats/summary error:', error);
    next(error);
  }
});

// Get monthly trends for the last 6 months
router.get('/stats/trends', (req, res, next) => {
  try {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }

    const trends = months.map(month => {
      const claimsStmt = db.prepare("SELECT COUNT(*) as count FROM claims WHERE strftime('%Y-%m', created_at) = ?").get(month);
      const claims = claimsStmt ? claimsStmt.count : 0;
      const approvedStmt = db.prepare("SELECT COUNT(*) as count FROM claims WHERE strftime('%Y-%m', created_at) = ? AND status = 'approved'").get(month);
      const approved = approvedStmt ? approvedStmt.count : 0;
      const date = new Date(month + '-01');
      const monthLabel = date.toLocaleString('default', { month: 'short' });
      return { month: monthLabel, claims, approved };
    });

    res.json(trends);
  } catch (error) {
    next(error);
  }
});

// Get claim distribution by state
router.get('/stats/state-distribution', (req, res, next) => {
  try {
    const distribution = db.prepare(`
      SELECT state as name, COUNT(*) as value 
      FROM claims 
      GROUP BY state
    `).all();

    const stateColors = {
      'Madhya Pradesh': '#3B82F6',
      'Odisha': '#10B981',
      'Telangana': '#F59E0B',
      'Tripura': '#EF4444'
    };

    const result = distribution.map(item => ({
      ...item,
      color: stateColors[item.name] || '#6366F1'
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get claim distribution by district (top 15)
router.get('/stats/district-distribution', (req, res, next) => {
  try {
    const distribution = db.prepare(`
      SELECT district as name, COUNT(*) as value,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) as pending
      FROM claims
      WHERE district IS NOT NULL AND district != ''
      GROUP BY district
      ORDER BY value DESC
      LIMIT 15
    `).all();
    res.json(distribution);
  } catch (error) {
    next(error);
  }
});


// Approve claim (explicit endpoint)
router.post('/:id/approve', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { actor_user_id } = req.body;
    const upd = db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('approved', id);
    if (upd.changes === 0) return res.status(404).json({ message: 'Claim not found' });
    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    try {
      db.prepare(`INSERT INTO system_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`)
        .run('claim_approved', actor_user_id || null, 'claim', id, JSON.stringify({ status: 'approved' }));
    } catch (e) {}
    res.json(claim);
  } catch (error) {
    res.status(500).json({ message: 'Error approving claim', error: error.message });
  }
});

// Reject claim (explicit endpoint)
router.post('/:id/reject', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { actor_user_id, reason } = req.body;
    const trimmed = String(reason || '').trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }
    const upd = db.prepare('UPDATE claims SET status = ?, rejection_reason = ? WHERE id = ?').run('rejected', trimmed, id);
    if (upd.changes === 0) return res.status(404).json({ message: 'Claim not found' });
    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    try {
      db.prepare(`INSERT INTO system_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`)
        .run('claim_rejected', actor_user_id || null, 'claim', id, JSON.stringify({ status: 'rejected', reason: trimmed }));
    } catch (e) {}
    res.json(claim);
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting claim', error: error.message });
  }
});

// Create and submit claim with documents (multipart) and model integration
router.post('/submit', upload.array('documents'), async (req, res) => {
  try {
    // Text fields
    const { claimant_name, village, state, district, polygon, user_id } = req.body;
    if (!claimant_name || !village || !state || !district) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // 1) Create claim record first (without documents yet)
    const insert = db.prepare(`
      INSERT INTO claims (claimant_name, village, state, district, polygon, documents, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const polygonStr = polygon ? polygon : '[]';
    const info = insert.run(
      claimant_name,
      village,
      state,
      district,
      polygonStr,
      JSON.stringify([]),
      user_id || null
    );
    const claimId = info.lastInsertRowid;

    // 2) Move files to permanent folder per claim
    const claimDir = path.join(UPLOADS_ROOT, 'claims', String(claimId));
    if (!fs.existsSync(claimDir)) fs.mkdirSync(claimDir, { recursive: true });

    const uploaded = req.files || [];
    const savedPaths = [];
    for (const f of uploaded) {
      const targetPath = path.join(claimDir, f.originalname);
      fs.renameSync(f.path, targetPath);
      savedPaths.push(targetPath);
    }

    // 3) Update claim with document paths (relative to backend directory for portability)
    const relativePaths = savedPaths.map(p => path.relative(path.join(__dirname, '..'), p));
    db.prepare('UPDATE claims SET documents = ? WHERE id = ?').run(JSON.stringify(relativePaths), claimId);

    // 4) Call local Python model API
    let modelResult = null;
    let modelStatus = 'not_run';
    try {
      modelResult = await callModelAPI(savedPaths, {
        claimId,
        claimant_name,
        village,
        state,
        district,
        existing_claims: buildModelCandidates(claimId),
      });
      modelStatus = 'success';
    } catch (err) {
      modelStatus = 'error';
      modelResult = { error: err.message };
    }

    // 5) Save model result to disk and DB
    const resultFile = path.join(claimDir, 'model_result.json');
    try { fs.writeFileSync(resultFile, JSON.stringify(modelResult, null, 2)); } catch (e) {}
    db.prepare('UPDATE claims SET model_result = ?, model_status = ?, model_run_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(modelResult), modelStatus, claimId);

    const newClaim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);

    return res.status(201).json(newClaim);
  } catch (error) {
    console.error('Error submitting claim with documents:', error);
    return res.status(500).json({ message: 'Error submitting claim', error: error.message });
  }
});

module.exports = router;
