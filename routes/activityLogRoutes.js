const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLog.controller');
const authMiddleware = require('../middleware/auth.middleware');

// GET /api/activity-logs?page=1&limit=20 (admin and superadmin)
router.get(
  '/',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(['admin', 'superadmin']),
  activityLogController.getActivityLogs
);

module.exports = router;
