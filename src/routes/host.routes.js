const express = require('express');
const router = express.Router();
const hostController = require('../controllers/host.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');

// All routes require host authentication
router.use(authMiddleware.verifyToken, authMiddleware.verifyHost);

// Dashboard
router.get('/dashboard', hostController.getDashboardStats);
router.get('/profile', hostController.getHostProfile);
router.patch('/profile', hostController.updateHostProfile);

// Events
router.get('/events', hostController.getHostEvents);

// Payouts
router.get('/payouts', hostController.getHostPayouts);

// Bank details
router.post(
  '/bank-details',
  validationMiddleware.validateUpdateBankDetails,
  hostController.updateBankDetails
);

module.exports = router;