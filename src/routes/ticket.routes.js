const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');

// Public ticket validation
router.post(
  '/validate',
  validationMiddleware.validateScanTicket,
  ticketController.validateTicket
);

// Ticket scanning (requires authentication - scanner)
router.post(
  '/scan',
  authMiddleware.verifyToken,
  validationMiddleware.validateScanTicket,
  ticketController.scanTicket
);

// Get ticket by ID (authenticated users)
router.get(
  '/:ticketId',
  authMiddleware.optionalAuth,
  ticketController.getTicketById
);

// Download ticket
router.get(
  '/:ticketId/download/:format',
  authMiddleware.optionalAuth,
  ticketController.downloadTicket
);

// Get tickets by order
router.get(
  '/order/:orderId',
  authMiddleware.optionalAuth,
  ticketController.getTicketsByOrder
);

// Protected routes (host only)
router.use(authMiddleware.verifyToken, authMiddleware.verifyHost);

// Get tickets by event
router.get('/event/:eventId', ticketController.getTicketsByEvent);

module.exports = router;