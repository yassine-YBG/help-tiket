const express = require('express');
const router = express.Router();
const statsController = require('../controllers/stats.controller');
const authMiddleware = require('../middleware/auth.middleware');

// GET /api/stats?from=2026-10-01&to=2026-10-31&interval=week (admin and superadmin)
router.get(
  '/',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(['admin', 'superadmin']),
  statsController.getStats
);

module.exports = router;
