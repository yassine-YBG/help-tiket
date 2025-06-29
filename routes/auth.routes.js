const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Register
router.post('/register', authController.register);

// Login
router.post('/login', authController.login);

router.get(
  '/users',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(['admin', 'superadmin']),
  authController.getUsers
);



// Delete user (admin and superadmin)
router.delete(
  '/users/:id',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(['admin', 'superadmin']),
  authController.deleteUser
);

// Activate/deactivate user (admin and superadmin)
router.put(
  '/users/:id/activation',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(['admin', 'superadmin']),
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
