const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload');

const ADMINS = ['admin', 'superadmin'];

router.post(
  '/create',
  authMiddleware.verifyToken,
  upload.array('attachments', 5), // max 5 files
  ticketController.createTicket
);

router.get(
  '/',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  ticketController.getAllTickets
);

router.get(
  '/my',
  authMiddleware.verifyToken,
  ticketController.getMyTickets
);

router.put(
  '/assign/:id',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  ticketController.assignHandler
);

router.post(
  '/reply/:id',
  authMiddleware.verifyToken,
  upload.array('attachments', 5), // max 5 files
  ticketController.replyToTicket
);

// file download route
router.get(
  '/:ticketId/attachment/:type/:attachmentId/download',
  authMiddleware.verifyToken,
  ticketController.downloadAttachment
);

router.put(
  '/status/:id',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  ticketController.updateStatus
);

// Mettre à jour la priorité (propriétaire, admin, superadmin)
router.put(
  '/priority/:id',
  authMiddleware.verifyToken,
  ticketController.updatePriority
);

// NEW: get one ticket (owner, admin, superadmin) — keep after /my
router.get(
  '/:id',
  authMiddleware.verifyToken,
  ticketController.getTicketById
);

// NEW: soft delete a ticket (admin, superadmin)
router.delete(
  '/:id',
  authMiddleware.verifyToken,
  authMiddleware.requireRole(ADMINS),
  ticketController.softDeleteTicket
);

module.exports = router;
