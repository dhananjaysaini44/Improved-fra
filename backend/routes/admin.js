const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// GET /api/admin/claims/:id/khasra-verify
router.get('/claims/:id/khasra-verify', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const claim = db.prepare('SELECT khasra_no, state, village, district FROM claims WHERE id = ?').get(id);
    
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    if (!claim.khasra_no) {
      return res.status(400).json({ message: 'No Khasra number associated with this claim' });
    }
    
    let portalUrl = '';
    const state = (claim.state || '').toLowerCase();
    
    // Construct state-specific portal deep links
    if (state.includes('madhya pradesh') || state === 'mp') {
      portalUrl = `https://mpbhulekh.gov.in/KhasraCopy.do?khasraNo=${encodeURIComponent(claim.khasra_no)}`;
    } else if (state.includes('odisha') || state === 'or') {
      portalUrl = `https://bhulekh.ori.nic.in/RoRView.aspx?khasra=${encodeURIComponent(claim.khasra_no)}`;
    } else if (state.includes('telangana') || state === 'ts') {
      portalUrl = `https://dharani.telangana.gov.in/searchKhasra?khasra=${encodeURIComponent(claim.khasra_no)}`;
    } else if (state.includes('tripura') || state === 'tr') {
      portalUrl = `https://jami.tripura.gov.in/`; // Deep links for Tripura are less standardized
    }

    res.json({
      khasra_no: claim.khasra_no,
      state: claim.state,
      portalUrl
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching verification data', error: error.message });
  }
});

// Update claim verification flags - Admin only
// PATCH /api/admin/claims/:id
router.patch('/claims/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { patwari_verified } = req.body;
    
    if (patwari_verified === undefined) {
      return res.status(400).json({ message: 'patwari_verified field is required' });
    }
    
    const info = db.prepare('UPDATE claims SET patwari_verified = ? WHERE id = ?')
      .run(patwari_verified ? 1 : 0, id);
      
    if (info.changes === 0) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    res.json({ success: true, patwari_verified: !!patwari_verified });
  } catch (error) {
    res.status(500).json({ message: 'Error updating verification status', error: error.message });
  }
});

module.exports = router;
