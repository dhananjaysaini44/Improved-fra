const assert = require('assert');
const db = require('../db');
const claimsRouter = require('../routes/claims');

const {
  mergeClaimReadModel,
  persistPipelineResult,
} = claimsRouter._internal;

function ensureTestMigrations() {
  try { db.exec("ALTER TABLE land_parcels ADD COLUMN reference_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE land_parcels ADD COLUMN source_name TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE land_parcels ADD COLUMN match_confidence REAL"); } catch (e) {}
  try { db.exec("ALTER TABLE land_parcels ADD COLUMN match_basis TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE land_parcels ADD COLUMN metadata_json TEXT"); } catch (e) {}
}

function cleanupClaim(claimId) {
  db.prepare('DELETE FROM system_logs WHERE entity_type = ? AND entity_id = ?').run('claim', claimId);
  db.prepare('DELETE FROM land_parcels WHERE claim_id = ?').run(claimId);
  db.prepare('DELETE FROM spatial_conflicts WHERE claim_id = ?').run(claimId);
  db.prepare('DELETE FROM confidence_scores WHERE claim_id = ?').run(claimId);
  db.prepare('DELETE FROM nlp_results WHERE claim_id = ?').run(claimId);
  db.prepare('DELETE FROM claims WHERE id = ?').run(claimId);
}

function run() {
  ensureTestMigrations();

  const referenceInserted = db.prepare(`
    INSERT INTO claims (claimant_name, village, state, district, polygon, documents, user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Reference Claimant',
    'Reference Village',
    'MP',
    'Dindori',
    JSON.stringify({
      type: 'Polygon',
      coordinates: [[[80.002, 23.002], [80.003, 23.002], [80.003, 23.003], [80.002, 23.003], [80.002, 23.002]]],
    }),
    JSON.stringify([]),
    null,
    'approved'
  );
  const referenceClaimId = referenceInserted.lastInsertRowid;

  const inserted = db.prepare(`
    INSERT INTO claims (claimant_name, village, state, district, polygon, documents, user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Pipeline Test Claimant',
    'Test Village',
    'MP',
    'Dindori',
    JSON.stringify({
      type: 'Polygon',
      coordinates: [[[80.0, 23.0], [80.001, 23.0], [80.001, 23.001], [80.0, 23.001], [80.0, 23.0]]],
    }),
    JSON.stringify([]),
    null,
    'pending'
  );

  const claimId = inserted.lastInsertRowid;

  try {
    persistPipelineResult(claimId, {
      pipeline_status: 'SCORED',
      validation: {
        fields_complete_ratio: 1,
        missing_fields: [],
      },
      nlp: {
        similarity_score: 0.92,
        is_duplicate: true,
        flagged_reason: 'Similarity threshold exceeded',
        top_matching_claim_id: referenceClaimId,
      },
      gis: {
        gis_score: 0.4,
        conflicts: [
          {
            conflicting_claim_id: referenceClaimId,
            overlap_area: 0.015,
            conflict_type: 'EXISTING_CLAIM',
          },
        ],
        warnings: ['Submitted polygon area differs substantially from OCR-extracted land area.'],
      },
      parcel: {
        source_available: true,
        best_match: {
          reference_id: 'PARCEL-42',
          source_name: 'parcel_records',
          match_confidence: 0.81,
          match_basis: ['survey number matched', 'claim polygon intersects reference geometry'],
          area_ha: 1.75,
          is_restricted: true,
          boundaries_geojson: { type: 'Point', coordinates: [80.0005, 23.0005] },
        },
      },
      score: {
        ocr_score: 0.8,
        nlp_score: 0.92,
        gis_score: 0.4,
        overall_score: 0.74,
        is_suspicious: true,
      },
    });

    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
    const merged = mergeClaimReadModel(claim);

    assert.strictEqual(merged.pipeline_status, 'SCORED');
    assert.ok(merged.pipeline_result, 'pipeline_result should be attached');
    assert.strictEqual(merged.pipeline_result.parcel.best_match.reference_id, 'PARCEL-42');
    assert.strictEqual(merged.pipeline_result.gis.conflicts.length, 1);
    assert.strictEqual(merged.review_summary.severity, 'review');
    assert.ok(
      merged.review_summary.reasons.some((reason) => reason.includes('duplicate')),
      'review summary should mention duplicate risk'
    );
    assert.ok(
      merged.review_summary.reasons.some((reason) => reason.includes('restricted')),
      'review summary should mention restricted parcel'
    );

    console.log('pipeline-read-model test passed');
  } finally {
    cleanupClaim(claimId);
    cleanupClaim(referenceClaimId);
  }
}

run();
