const express = require('express');
const router = express.Router();
const paymentService = require('../services/payment.service');

// M-Pesa callback URL (public)
router.post('/callback', async (req, res) => {
  try {
    console.log('M-Pesa callback received:', JSON.stringify(req.body, null, 2));
    
    const result = await paymentService.validateCallback(req.body);
    
    if (result.success) {
      console.log('Payment successful:', result);
      res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Success'
      });
    } else {
      console.log('Payment failed:', result);
      res.status(200).json({
        ResultCode: result.resultCode,
        ResultDesc: result.resultDesc
      });
    }
  } catch (error) {
    console.error('Error processing callback:', error);
    res.status(200).json({
      ResultCode: 1,
      ResultDesc: 'Error processing callback'
    });
  }
});

// Test payment endpoint (development only)
if (process.env.NODE_ENV === 'development') {
  router.post('/test', async (req, res) => {
    const { amount, phone, orderId } = req.body;
    
    try {
      const result = await paymentService.initiateSTKPush(amount, phone, orderId, 'Test payment');
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = router;