const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkout.controller');
const validationMiddleware = require('../middlewares/validation.middleware');
const authMiddleware = require('../middlewares/auth.middleware');

// Public checkout (no authentication required for buyers)
router.post(
  '/',
  validationMiddleware.validateCheckout,
  checkoutController.createCheckout
);

router.post(
  '/payment',
  validationMiddleware.validateInitiatePayment,
  checkoutController.initiatePayment
);

router.get(
  '/order/:orderId/status',
  checkoutController.checkPaymentStatus
);

// Protected routes (for viewing order details)
router.get(
  '/order/:orderId',
  authMiddleware.optionalAuth,
  checkoutController.getOrderDetails
);

module.exports = router;