const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { authLimiter, passwordLimiter } = require('../middleware/rateLimit');

const ADMINS = ['admin', 'superadmin'];

// Register
router.post('/register', authLimiter, authController.register);

// Login
router.post('/login', authLimiter, authController.login);

// Current user (any logged-in role) — NEW
router.get('/me', authMiddleware.verifyToken, authController.getMe);

// Change my password (any logged-in role) — NEW
router.put(
  '/me/password',
  authMiddleware.verifyToken,
  passwordLimiter,
  authController.changePassword
);

router.get(
  '/users',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  authController.getUsers
);

// Pending users (declared before /users/:id routes)
router.get(
  '/users/pending',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  authController.getPendingUsers
);

// Delete user (admin and superadmin) — soft delete, the user stays in the DB
router.delete(
  '/users/:id',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  authController.softDeleteUser
);

// Restore a deleted user (admin and superadmin) — NEW route
router.put(
  '/users/:id/restore',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  authController.restoreUser
);

// Activate/deactivate user (admin and superadmin)
router.put(
  '/users/:id/activation',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  authController.toggleActivation
);

// Update role (superadmin only)
router.put(
  '/users/:id/role',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(['superadmin']),
  authController.updateRole
);

module.exports = router;
