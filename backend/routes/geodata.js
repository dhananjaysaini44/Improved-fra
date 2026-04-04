const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to map rows to simple objects
const mapRows = (rows) => rows.map(r => ({ ...r }));

// GET /states - distinct states
router.get('/states', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT state_code AS code, state_name AS name FROM location_hierarchy').all();
    res.json(mapRows(rows));
  } catch (e) {
    console.error('Error fetching states', e);
    res.status(500).json({ message: 'Failed to fetch states' });
  }
});

// GET /districts/:state
router.get('/districts/:state', (req, res) => {
  const { state } = req.params;
  try {
    const rows = db.prepare('SELECT DISTINCT district_code AS code, district_name AS name FROM location_hierarchy WHERE state_code = ?').all(state);
    res.json(mapRows(rows));
  } catch (e) {
    console.error('Error fetching districts', e);
    res.status(500).json({ message: 'Failed to fetch districts' });
  }
});

// GET /tehsils/:state/:district
router.get('/tehsils/:state/:district', (req, res) => {
  const { state, district } = req.params;
  try {
    const rows = db.prepare('SELECT DISTINCT tehsil_code AS code, tehsil_name AS name FROM location_hierarchy WHERE state_code = ? AND district_code = ?').all(state, district);
    res.json(mapRows(rows));
  } catch (e) {
    console.error('Error fetching tehsils', e);
    res.status(500).json({ message: 'Failed to fetch tehsils' });
  }
});

// GET /villages/:state/:district/:tehsil
router.get('/villages/:state/:district/:tehsil', (req, res) => {
  const { state, district, tehsil } = req.params;
  try {
    const rows = db.prepare('SELECT village_code AS code, village_name AS name FROM location_hierarchy WHERE state_code = ? AND district_code = ? AND tehsil_code = ?').all(state, district, tehsil);
    res.json(mapRows(rows));
  } catch (e) {
    console.error('Error fetching villages', e);
    res.status(500).json({ message: 'Failed to fetch villages' });
  }
});

// POST /khasra/check – must be registered before /khasra/:villageCode
router.post('/khasra/check', (req, res) => {
  const { khasra_no, village_code } = req.body;
  if (!khasra_no || !village_code) {
    return res.status(400).json({ message: 'khasra_no and village_code required' });
  }
  try {
    const conflict = db.prepare('SELECT id FROM claims WHERE khasra_no = ? AND village_code = ? AND status != "rejected"').get(khasra_no, village_code);
    if (conflict) {
      return res.json({ available: false, existingClaimId: conflict.id });
    }
    res.json({ available: true });
  } catch (e) {
    console.error('Error checking khasra', e);
    res.status(500).json({ message: 'Failed to check khasra' });
  }
});

// GET /khasra/:villageCode – return GeoJSON of plots for a village
router.get('/khasra/:villageCode', (req, res) => {
  const { villageCode } = req.params;
  try {
    const rows = db.prepare('SELECT * FROM khasra_plots WHERE village_code = ?').all(villageCode);
    const features = rows.map(r => ({
      type: 'Feature',
      properties: {
        khasra_no: r.khasra_no,
        khata_no: r.khata_no,
        area_hectares: r.area_hectares,
        status: r.status || 'available'
      },
      geometry: typeof r.polygon === 'string' ? JSON.parse(r.polygon) : r.polygon
    }));
    res.json({ type: 'FeatureCollection', features });
  } catch (e) {
    console.error('Error fetching khasra plots', e);
    res.status(500).json({ message: 'Failed to fetch plots' });
  }
});

module.exports = router;
