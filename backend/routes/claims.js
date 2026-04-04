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
const { generateHash } = require('../utils/hash');
const { anchorToAlgorand } = require('../services/algorand');

const normalizeState = (state) => {
  if (!state) return state;
  const mapping = {
    'MP': 'Madhya Pradesh',
    'Madhyapradesh': 'Madhya Pradesh',
    'OD': 'Odisha',
    'OR': 'Odisha',
    'Orissa': 'Odisha',
    'TR': 'Tripura',
    'TS': 'Telangana',
    'TL': 'Telangana'
  };
  return mapping[state] || state;
};


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
  const timeout = Number(process.env.MODEL_TIMEOUT_MS || 180000);
  const maxRetries = Number(process.env.MODEL_MAX_RETRIES || 2);
  const retryDelayMs = Number(process.env.MODEL_RETRY_DELAY_MS || 1500);
  const extractErrorMessage = (err) => {
    const status = err?.response?.status;
    const detail = err?.response?.data;
    if (status && detail) {
      if (typeof detail === 'string') return `${status}: ${detail}`;
      if (typeof detail === 'object') {
        if (typeof detail.message === 'string') return `${status}: ${detail.message}`;
        if (typeof detail.detail === 'string') return `${status}: ${detail.detail}`;
        return `${status}: ${JSON.stringify(detail)}`;
      }
    }
    return err?.message || 'Model API call failed';
  };

  const shouldRetry = (err) => {
    if (!err) return false;
    if (err.code === 'ECONNABORTED') return true;
    if (String(err.message || '').toLowerCase().includes('timeout')) return true;
    const status = err.response?.status;
    return status === 429 || (typeof status === 'number' && status >= 500);
  };

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const form = new FormData();
    files.forEach((filePath) => {
      const stream = fs.createReadStream(filePath);
      form.append('documents', stream, path.basename(filePath));
    });
    form.append('metadata', JSON.stringify(payload || {}));

    const headers = form.getHeaders();
    if (process.env.MODEL_API_KEY) {
      headers['x-api-key'] = process.env.MODEL_API_KEY;
    }

    try {
      const response = await axios.post(endpoint, form, {
        headers,
        timeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return response.data;
    } catch (err) {
      lastError = err;
      if (attempt > maxRetries || !shouldRetry(err)) {
        err.message = extractErrorMessage(err);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  throw lastError || new Error('Model API call failed');
}

function cleanupTempUploads(files) {
  for (const f of files || []) {
    if (!f?.path) continue;
    try {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch (err) {
      // best-effort temp cleanup
    }
  }
}

function findRecentDuplicateSubmission({ claimant_name, village, state, district, polygon, user_id, windowSeconds }) {
  const seconds = Number(windowSeconds || 120);
  const windowExpr = `-${Math.max(1, seconds)} seconds`;
  return db.prepare(`
    SELECT *
    FROM claims
    WHERE claimant_name = ?
      AND village = ?
      AND state = ?
      AND district = ?
      AND IFNULL(polygon, '[]') = IFNULL(?, '[]')
      AND IFNULL(CAST(user_id AS TEXT), '') = IFNULL(CAST(? AS TEXT), '')
      AND created_at >= datetime('now', ?)
    ORDER BY id DESC
    LIMIT 1
  `).get(
    claimant_name,
    village,
    state,
    district,
    polygon || '[]',
    user_id || null,
    windowExpr
  );
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

function buildReviewSummary(pipeline) {
  const reasons = [];
  if (!pipeline || typeof pipeline !== 'object') {
    return { severity: 'pending', reasons, recommendation: 'Await OCR and pipeline processing.' };
  }

  const conflicts = Array.isArray(pipeline.gis?.conflicts) ? pipeline.gis.conflicts.length : 0;
  const warnings = Array.isArray(pipeline.gis?.warnings) ? pipeline.gis.warnings : [];
  const parcel = pipeline.parcel?.best_match || null;
  const suspicious = !!pipeline.score?.is_suspicious;
  const duplicate = !!pipeline.nlp?.is_duplicate;

  if (duplicate) reasons.push('Potential duplicate claim detected by NLP comparison.');
  if (conflicts > 0) reasons.push(`${conflicts} spatial conflict(s) detected against other claims.`);
  if (warnings.length > 0) reasons.push(...warnings.slice(0, 3));
  if (parcel?.is_restricted) reasons.push('Matched parcel or compartment is marked as restricted.');
  if (parcel?.reference_id) reasons.push(`Reference parcel match found: ${parcel.reference_id}.`);

  let severity = 'clear';
  if (suspicious || duplicate || conflicts > 0 || parcel?.is_restricted) {
    severity = 'review';
  } else if ((pipeline.pipeline_status || '').toUpperCase().includes('PENDING') || !pipeline.score) {
    severity = 'pending';
  }

  return {
    severity,
    reasons,
    recommendation: severity === 'review'
      ? 'Manual admin review recommended before approval.'
      : severity === 'pending'
        ? 'Await pipeline completion before final review.'
        : 'No major automated concerns detected.',
  };
}

function buildPipelineResultForClaims(claimIds) {
  if (!Array.isArray(claimIds) || claimIds.length === 0) return new Map();

  const idPlaceholders = claimIds.map(() => '?').join(', ');
  const nlpRows = db.prepare(`
    SELECT claim_id, similarity_score, is_duplicate, flagged_reason, top_matching_claim, processed_at
    FROM nlp_results
    WHERE claim_id IN (${idPlaceholders})
  `).all(...claimIds);
  const scoreRows = db.prepare(`
    SELECT claim_id, ocr_score, nlp_score, gis_score, overall_score, is_suspicious, computed_at
    FROM confidence_scores
    WHERE claim_id IN (${idPlaceholders})
  `).all(...claimIds);
  const conflictRows = db.prepare(`
    SELECT claim_id, conflicting_claim_id, overlap_area, conflict_type, is_resolved, detected_at
    FROM spatial_conflicts
    WHERE claim_id IN (${idPlaceholders})
    ORDER BY detected_at DESC
  `).all(...claimIds);
  const parcelRows = db.prepare(`
    SELECT claim_id, boundaries_geojson, area, land_cover_type, is_restricted, survey_date, reference_id, source_name, match_confidence, match_basis, metadata_json
    FROM land_parcels
    WHERE claim_id IN (${idPlaceholders})
    ORDER BY id DESC
  `).all(...claimIds);
  const logRows = db.prepare(`
    SELECT entity_id, details
    FROM system_logs
    WHERE action = 'ml_pipeline:completed'
      AND entity_type = 'claim'
      AND entity_id IN (${idPlaceholders})
    ORDER BY created_at DESC, id DESC
  `).all(...claimIds);

  const byClaimId = new Map();
  for (const claimId of claimIds) {
    byClaimId.set(claimId, {
      pipeline_status: 'PENDING',
      nlp: null,
      score: null,
      gis: { conflicts: [], warnings: [] },
      parcel: null,
    });
  }

  for (const row of nlpRows) {
    const existing = byClaimId.get(row.claim_id) || {};
    existing.nlp = {
      similarity_score: Number(row.similarity_score || 0),
      is_duplicate: !!row.is_duplicate,
      flagged_reason: row.flagged_reason || null,
      top_matching_claim_id: row.top_matching_claim || null,
      processed_at: row.processed_at || null,
    };
    byClaimId.set(row.claim_id, existing);
  }

  for (const row of scoreRows) {
    const existing = byClaimId.get(row.claim_id) || {};
    existing.score = {
      ocr_score: Number(row.ocr_score || 0),
      nlp_score: Number(row.nlp_score || 0),
      gis_score: Number(row.gis_score || 0),
      overall_score: Number(row.overall_score || 0),
      is_suspicious: !!row.is_suspicious,
      computed_at: row.computed_at || null,
    };
    byClaimId.set(row.claim_id, existing);
  }

  for (const row of conflictRows) {
    const existing = byClaimId.get(row.claim_id) || { gis: { conflicts: [], warnings: [] } };
    if (!existing.gis) existing.gis = { conflicts: [], warnings: [] };
    existing.gis.conflicts.push({
      conflicting_claim_id: row.conflicting_claim_id || null,
      overlap_area: Number(row.overlap_area || 0),
      conflict_type: row.conflict_type || 'PENDING_CLAIM',
      is_resolved: !!row.is_resolved,
      detected_at: row.detected_at || null,
    });
    byClaimId.set(row.claim_id, existing);
  }

  for (const row of parcelRows) {
    const existing = byClaimId.get(row.claim_id) || {};
    let parcel = null;
    try {
      parcel = row.metadata_json ? JSON.parse(row.metadata_json) : null;
    } catch (err) {
      parcel = null;
    }
    if (!parcel) {
      let boundaries = null;
      let matchBasis = [];
      try {
        boundaries = row.boundaries_geojson ? JSON.parse(row.boundaries_geojson) : null;
      } catch (err) {}
      try {
        matchBasis = row.match_basis ? JSON.parse(row.match_basis) : [];
      } catch (err) {}
      parcel = {
        source_available: true,
        candidate_matches: [],
        best_match: {
          reference_id: row.reference_id || null,
          source_name: row.source_name || null,
          match_confidence: Number(row.match_confidence || 0),
          match_basis: matchBasis,
          area_ha: row.area !== null ? Number(row.area) : null,
          land_cover_type: row.land_cover_type || null,
          is_restricted: !!row.is_restricted,
          survey_date: row.survey_date || null,
          boundaries_geojson: boundaries,
        },
      };
    }
    existing.parcel = parcel;
    byClaimId.set(row.claim_id, existing);
  }

  for (const row of logRows) {
    if (!row?.entity_id || !row.details || !byClaimId.has(row.entity_id)) continue;
    const existing = byClaimId.get(row.entity_id);
    if (existing.gis && existing.gis.__hydratedFromLog) continue;

    try {
      const parsed = JSON.parse(row.details);
      if (parsed?.gis && typeof parsed.gis === 'object') {
        existing.gis = {
          ...(parsed.gis || {}),
          conflicts: Array.isArray(parsed.gis.conflicts) ? parsed.gis.conflicts : existing.gis?.conflicts || [],
          warnings: Array.isArray(parsed.gis.warnings) ? parsed.gis.warnings : [],
          __hydratedFromLog: true,
        };
      }
      if (parsed?.score && !existing.score) {
        existing.score = parsed.score;
      }
      if (parsed?.nlp && !existing.nlp) {
        existing.nlp = parsed.nlp;
      }
      if (parsed?.parcel && !existing.parcel) {
        existing.parcel = parsed.parcel;
      }
      if (parsed?.pipeline_status && !existing.pipeline_status) {
        existing.pipeline_status = parsed.pipeline_status;
      }
      byClaimId.set(row.entity_id, existing);
    } catch (err) {
      // Ignore malformed log payloads; table-backed data remains authoritative.
    }
  }

  for (const claimId of claimIds) {
    const existing = byClaimId.get(claimId);
    if (!existing) continue;
    if (existing.gis && Object.prototype.hasOwnProperty.call(existing.gis, '__hydratedFromLog')) {
      delete existing.gis.__hydratedFromLog;
    }
    if (existing.score) {
      existing.pipeline_status = existing.score.is_suspicious ? 'SCORED_REVIEW' : 'SCORED';
    } else if (existing.nlp || (existing.gis && existing.gis.conflicts.length)) {
      existing.pipeline_status = 'PROCESSING';
    }
  }

  return byClaimId;
}

function mergeClaimReadModel(claim, pipelineByClaimId = null) {
  if (!claim) return claim;
  const pipeline = pipelineByClaimId
    ? pipelineByClaimId.get(claim.id)
    : buildPipelineResultForClaims([claim.id]).get(claim.id);

  if (!pipeline) {
    return claim;
  }

  return {
    ...claim,
    pipeline_result: pipeline,
    pipeline_status: claim.pipeline_status || pipeline.pipeline_status,
    review_summary: buildReviewSummary(pipeline),
  };
}

function mergeClaimReadModels(claims) {
  if (!Array.isArray(claims) || claims.length === 0) return claims || [];
  const claimIds = claims.map((claim) => claim.id).filter(Boolean);
  const pipelineByClaimId = buildPipelineResultForClaims(claimIds);

  return claims.map((claim) => mergeClaimReadModel(claim, pipelineByClaimId));
}

function persistPipelineResult(claimId, pipelineResult) {
  if (!claimId || !pipelineResult || typeof pipelineResult !== 'object') return;

  const status = String(pipelineResult.pipeline_status || 'PIPELINE_ERROR');
  const validation = pipelineResult.validation || {};
  const nlp = pipelineResult.nlp || {};
  const gis = pipelineResult.gis || {};
  const parcel = pipelineResult.parcel || {};
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

    db.prepare('DELETE FROM land_parcels WHERE claim_id = ?').run(claimId);
    if (parcel.best_match && typeof parcel.best_match === 'object') {
      db.prepare(`
        INSERT INTO land_parcels (
          claim_id,
          boundaries_geojson,
          area,
          land_cover_type,
          is_restricted,
          survey_date,
          reference_id,
          source_name,
          match_confidence,
          match_basis,
          metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claimId,
        parcel.best_match.boundaries_geojson ? safeJson(parcel.best_match.boundaries_geojson, null) : null,
        parcel.best_match.area_ha !== undefined && parcel.best_match.area_ha !== null ? Number(parcel.best_match.area_ha) : null,
        parcel.best_match.land_cover_type || null,
        parcel.best_match.is_restricted ? 1 : 0,
        parcel.best_match.survey_date || null,
        parcel.best_match.reference_id || null,
        parcel.best_match.source_name || null,
        Number(parcel.best_match.match_confidence || 0),
        safeJson(parcel.best_match.match_basis || [], []),
        safeJson(parcel, {})
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
        parcel,
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
    {
      timeout,
      headers: process.env.MODEL_API_KEY
        ? { 'x-api-key': process.env.MODEL_API_KEY }
        : undefined,
    }
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
  const maxCandidates = Number(process.env.MODEL_EXISTING_CLAIMS_LIMIT || 150);
  const rows = db.prepare(`
    SELECT id, claimant_name, village, district, state, status, polygon, created_at
    FROM claims
    WHERE (? IS NULL OR id <> ?)
    ORDER BY created_at DESC
    LIMIT ?
  `).all(currentClaimId ?? null, currentClaimId ?? null, Math.max(1, maxCandidates));

  return rows.map((row) => ({
    id: row.id,
    claimant_name: row.claimant_name,
    village: row.village,
    district: row.district,
    state: row.state,
    polygon: row.polygon,
    status: row.status,
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
    const claims = mergeClaimReadModels(stmt.all(...params));
    
    res.json(claims);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Create new claim (JSON only, legacy)
router.post('/', (req, res) => {
  try {
    let { claimant_name, village, state, district, polygon, documents, user_id } = req.body;
    state = normalizeState(state);
    
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

// Get claim by ID
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('SELECT * FROM claims WHERE id = ?');
    const claim = mergeClaimReadModel(stmt.get(id));
    
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


// Approve claim (explicit endpoint)
router.post('/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_user_id } = req.body;
    const upd = db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('approved', id);
    if (upd.changes === 0) return res.status(404).json({ message: 'Claim not found' });
    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    
    // Algorand Shadow Blockchain Logic
    const payload = { ...claim, action: 'approved', action_actor: actor_user_id };
    const local_hash = generateHash(payload);
    let algorand_tx_id = null;
    
    try {
      algorand_tx_id = await anchorToAlgorand(local_hash);
    } catch (algorandError) {
      console.error('Algorand anchoring failed, continuing gracefully...', algorandError);
    }

    // Insert into local audit ledger
    db.prepare(`INSERT INTO audit_ledger (claim_id, action, admin_id, local_hash, algorand_tx_id, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`)
      .run(id, 'approved', actor_user_id || null, local_hash, algorand_tx_id);

    try {
      db.prepare(`INSERT INTO system_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`)
        .run('claim_approved', actor_user_id || null, 'claim', id, JSON.stringify({ status: 'approved', algorand_tx: algorand_tx_id }));
    } catch (e) {}
    
    res.json(claim);
  } catch (error) {
    res.status(500).json({ message: 'Error approving claim', error: error.message });
  }
});


// Reject claim (explicit endpoint)
router.post('/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
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
    
    // Algorand Shadow Blockchain Logic
    const payload = { ...claim, action: 'rejected', reason: trimmed, action_actor: actor_user_id };
    const local_hash = generateHash(payload);
    let algorand_tx_id = null;
    
    try {
      algorand_tx_id = await anchorToAlgorand(local_hash);
    } catch (algorandError) {
      console.error('Algorand anchoring failed, continuing gracefully...', algorandError);
    }

    // Insert into local audit ledger
    db.prepare(`INSERT INTO audit_ledger (claim_id, action, admin_id, local_hash, algorand_tx_id, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`)
      .run(id, 'rejected', actor_user_id || null, local_hash, algorand_tx_id);

    try {
      db.prepare(`INSERT INTO system_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`)
        .run('claim_rejected', actor_user_id || null, 'claim', id, JSON.stringify({ status: 'rejected', reason: trimmed, algorand_tx: algorand_tx_id }));
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
    let { 
      claimant_name, village, state, district, polygon, user_id,
      khasra_no, khata_no, village_code, tehsil_code, patwari_name, land_area_hectares 
    } = req.body;

    state = normalizeState(state);

    if (!claimant_name || !village || !state || !district) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Ensure polygon is a string (don't double-stringify if already stringified)
    const polygonStr = (typeof polygon === 'string') ? polygon : JSON.stringify(polygon || []);

    // PHASE 2 correction: Synchronous check for conflicting Khasra status
    if (khasra_no && village_code) {
      const conflict = db.prepare(`
        SELECT id FROM claims 
        WHERE khasra_no = ? AND village_code = ? AND status != 'rejected'
      `).get(khasra_no, village_code);

      if (conflict) {
        return res.status(409).json({ 
          message: 'Conflict: This Khasra is already claimed.', 
          conflictingClaimId: conflict.id 
        });
      }
    }

    const duplicateWindowSeconds = Number(process.env.CLAIM_DUPLICATE_WINDOW_SECONDS || 120);
    const recentDuplicate = findRecentDuplicateSubmission({
      claimant_name,
      village,
      state,
      district,
      polygon: polygonStr,
      user_id,
      windowSeconds: duplicateWindowSeconds,
    });

    if (recentDuplicate) {
      cleanupTempUploads(req.files || []);
      return res.status(200).json({
        ...mergeClaimReadModel(recentDuplicate),
        duplicate_submission_blocked: true,
        message: `Duplicate submit blocked: an identical claim was created within the last ${duplicateWindowSeconds} seconds.`,
      });
    }

    // 1) Create claim record first (without documents yet)
    const insert = db.prepare(`
      INSERT INTO claims (
        claimant_name, village, state, district, polygon, documents, user_id,
        khasra_no, khata_no, village_code, tehsil_code, patwari_name, land_area_hectares
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const info = insert.run(
      claimant_name,
      village,
      state,
      district,
      polygonStr,
      JSON.stringify([]),
      user_id || null,
      khasra_no || null,
      khata_no || null,
      village_code || null,
      tehsil_code || null,
      patwari_name || null,
      land_area_hectares || null
    );
    const claimId = info.lastInsertRowid;

    // Update khasra_plots if linked
    if (khasra_no && village_code) {
      try {
        db.prepare("UPDATE khasra_plots SET claimed_by = ? WHERE khasra_no = ? AND village_code = ?")
          .run(claimId, khasra_no, village_code);
      } catch (e) { /* plot might not be in our spatial table yet, handled gracefully */ }
    }

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

    // Non-blocking post-submit pipeline run. Skip when OCR/model call failed.
    if (modelStatus === 'success') {
      triggerPipelineAsync(claimId, newClaim, modelResult, buildModelCandidates(claimId));
    } else {
      persistPipelineError(claimId, `Skipped pipeline because model_status=${modelStatus}: ${modelResult?.error || 'unknown error'}`);
    }

    return res.status(201).json(newClaim);
  } catch (error) {
    console.error('Error submitting claim with documents:', error);
    cleanupTempUploads(req.files || []);
    return res.status(500).json({ message: 'Error submitting claim', error: error.message });
  }
});

router._internal = {
  buildPipelineResultForClaims,
  buildReviewSummary,
  mergeClaimReadModel,
  persistPipelineResult,
  persistPipelineError,
};

module.exports = router;
