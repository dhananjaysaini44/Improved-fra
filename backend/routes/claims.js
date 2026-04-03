const express = require('express');
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

function uniqueTargetPath(dirPath, originalName) {
  const parsed = path.parse(originalName || 'document');
  const safeBase = (parsed.name || 'document').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'document';
  const safeExt = parsed.ext || '';
  let candidate = path.join(dirPath, `${safeBase}${safeExt}`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirPath, `${safeBase}-${counter}${safeExt}`);
    counter += 1;
  }
  return candidate;
}

function bundleDocumentsIfNeeded(claimDir, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length <= 1) {
    return filePaths || [];
  }

  const archivePath = path.join(claimDir, 'documents_bundle.tar.gz');
  const archiveName = path.basename(archivePath);
  const entryNames = filePaths.map((filePath) => path.basename(filePath));

  execFileSync('tar', ['-czf', archivePath, '-C', claimDir, ...entryNames], {
    cwd: claimDir,
    stdio: 'ignore',
  });

  for (const filePath of filePaths) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      // Leave partially bundled files in place rather than failing the whole claim.
    }
  }

  return [archivePath];
}

function safeJson(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch (err) {
    return JSON.stringify(fallback);
  }
}

function persistPipelineResult(claimId, pipelineResult) {
  if (!claimId || !pipelineResult || typeof pipelineResult !== 'object') return;

  const status = String(pipelineResult.pipeline_status || 'PIPELINE_ERROR');
  const validation = pipelineResult.validation || {};
  const nlp = pipelineResult.nlp || {};
  const gis = pipelineResult.gis || {};
  const score = pipelineResult.score || {};

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE claims
      SET pipeline_status = ?
      WHERE id = ?
    `).run(status, claimId);

    db.prepare(`
      INSERT INTO nlp_results (claim_id, similarity_score, is_duplicate, flagged_reason, top_matching_claim)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(claim_id) DO UPDATE SET
        similarity_score = excluded.similarity_score,
        is_duplicate = excluded.is_duplicate,
        flagged_reason = excluded.flagged_reason,
        top_matching_claim = excluded.top_matching_claim,
        processed_at = CURRENT_TIMESTAMP
    `).run(
      claimId,
      Number(nlp.similarity_score || 0),
      nlp.is_duplicate ? 1 : 0,
      nlp.flagged_reason || null,
      nlp.top_matching_claim_id || null
    );

    db.prepare(`
      INSERT INTO confidence_scores (claim_id, ocr_score, nlp_score, gis_score, overall_score, is_suspicious)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(claim_id) DO UPDATE SET
        ocr_score = excluded.ocr_score,
        nlp_score = excluded.nlp_score,
        gis_score = excluded.gis_score,
        overall_score = excluded.overall_score,
        is_suspicious = excluded.is_suspicious,
        computed_at = CURRENT_TIMESTAMP
    `).run(
      claimId,
      Number(score.ocr_score || 0),
      Number(score.nlp_score || 0),
      Number(score.gis_score || 0),
      Number(score.overall_score || 0),
      score.is_suspicious ? 1 : 0
    );

    db.prepare('DELETE FROM spatial_conflicts WHERE claim_id = ?').run(claimId);
    for (const conflict of Array.isArray(gis.conflicts) ? gis.conflicts : []) {
      db.prepare(`
        INSERT INTO spatial_conflicts (claim_id, conflicting_claim_id, overlap_area, conflict_type, is_resolved)
        VALUES (?, ?, ?, ?, 0)
      `).run(
        claimId,
        conflict.conflicting_claim_id || null,
        Number(conflict.overlap_area || 0),
        conflict.conflict_type || 'PENDING_CLAIM'
      );
    }

    db.prepare(`
      INSERT INTO system_logs (action, user_id, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'ml_pipeline:completed',
      null,
      'claim',
      claimId,
      safeJson({
        pipeline_status: status,
        validation,
        nlp,
        gis,
        score,
      }, {})
    );
  });

  tx();
}

function persistPipelineError(claimId, errorMessage) {
  if (!claimId) return;
  const tx = db.transaction(() => {
    db.prepare('UPDATE claims SET pipeline_status = ? WHERE id = ?').run('PIPELINE_ERROR', claimId);
    db.prepare(`
      INSERT INTO system_logs (action, user_id, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'ml_pipeline:error',
      null,
      'claim',
      claimId,
      safeJson({ error: errorMessage }, {})
    );
  });
  tx();
}

function triggerPipelineAsync(claimId, claim, modelResult, existingClaims) {
  const modelEndpoint = process.env.MODEL_ENDPOINT || '';
  if (!modelEndpoint) return;
  const pipelineEndpoint = modelEndpoint.includes('/predict')
    ? modelEndpoint.replace('/predict', '/pipeline/run')
    : `${modelEndpoint.replace(/\/$/, '')}/pipeline/run`;
  const timeout = Number(process.env.MODEL_TIMEOUT_MS || 60000);

  axios.post(
    pipelineEndpoint,
    {
      claim_id: claimId,
      claim: claim || null,
      model_result: modelResult || {},
      existing_claims: existingClaims || [],
    },
    { timeout }
  )
    .then((resp) => {
      if (resp?.data?.status !== 'ok') {
        console.warn(`[Pipeline] claim ${claimId} returned non-ok status`);
        persistPipelineError(claimId, resp?.data?.message || 'Pipeline returned non-ok status');
        return;
      }
      persistPipelineResult(claimId, resp?.data?.result || {});
    })
    .catch((err) => {
      console.warn(`[Pipeline] claim ${claimId} trigger failed: ${err.message}`);
      persistPipelineError(claimId, err.message);
    });
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
    polygon: row.polygon,
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
router.get('/stats/summary', (req, res) => {
  try {
    const totalClaims = db.prepare('SELECT COUNT(*) as count FROM claims').get().count;
    const pendingClaims = db.prepare('SELECT COUNT(*) as count FROM claims WHERE status = "pending"').get().count;
    const approvedClaims = db.prepare('SELECT COUNT(*) as count FROM claims WHERE status = "approved"').get().count;
    const rejectedClaims = db.prepare('SELECT COUNT(*) as count FROM claims WHERE status = "rejected"').get().count;
    
    res.json({
      total: totalClaims,
      pending: pendingClaims,
      approved: approvedClaims,
      rejected: rejectedClaims
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching statistics', error: error.message });
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
      const targetPath = uniqueTargetPath(claimDir, f.originalname);
      fs.renameSync(f.path, targetPath);
      savedPaths.push(targetPath);
    }

    // 3) Call Python model API using the original uploaded files before optional bundling.
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

    // 4) Bundle multiple uploaded files into a single archive for long-term storage.
    const storedPaths = bundleDocumentsIfNeeded(claimDir, savedPaths);
    const relativePaths = storedPaths.map(p => path.relative(path.join(__dirname, '..'), p));
    db.prepare('UPDATE claims SET documents = ? WHERE id = ?').run(JSON.stringify(relativePaths), claimId);

    // 5) Save model result to disk and DB
    const resultFile = path.join(claimDir, 'model_result.json');
    try { fs.writeFileSync(resultFile, JSON.stringify(modelResult, null, 2)); } catch (e) {}
    db.prepare('UPDATE claims SET model_result = ?, model_status = ?, model_run_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(modelResult), modelStatus, claimId);

    const newClaim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);

    // Non-blocking post-submit pipeline run. Do not await or fail submit on pipeline errors.
    triggerPipelineAsync(claimId, newClaim, modelResult, buildModelCandidates(claimId));

    return res.status(201).json(newClaim);
  } catch (error) {
    console.error('Error submitting claim with documents:', error);
    return res.status(500).json({ message: 'Error submitting claim', error: error.message });
  }
});

module.exports = router;
