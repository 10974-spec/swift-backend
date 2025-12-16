const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');

// Public routes
router.post(
  '/register',
  validationMiddleware.validateRegister,
  authController.register
);

router.post(
  '/login',
  authMiddleware.loginRateLimit,
  validationMiddleware.validateLogin,
  authController.login
);

router.post(
  '/google',
  validationMiddleware.validateGoogleAuth,
  authController.googleAuth
);

router.post(
  '/facebook',
  validationMiddleware.validateFacebookAuth,
  authController.facebookAuth
);

router.post(
  '/refresh-token',
  authMiddleware.verifyRefreshToken,
  authController.refreshToken
);

router.post(
  '/logout',
  authController.logout
);

// Protected routes
router.get(
  '/me',
  authMiddleware.verifyToken,
  authController.getMe
);

router.patch(
  '/me',
  authMiddleware.verifyToken,
  authController.updateProfile
);

module.exports = router;