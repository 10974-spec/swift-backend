const express = require('express');
const router = express.Router();
const eventController = require('../controllers/event.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const validationMiddleware = require('../middlewares/validation.middleware');

// Public routes
router.get('/:slug', eventController.getEventBySlug);

// Protected routes (host only)
router.use(authMiddleware.verifyToken, authMiddleware.verifyHost);

// Event management - with file upload
router.post(
  '/create',
  validationMiddleware.validateCreateEvent,
  eventController.createEvent
);

// Event management - JSON only (no file upload)
router.post(
  '/create-json',
  validationMiddleware.validateCreateEvent,
  eventController.createEventJson
);

router.post('/publish/:eventId', eventController.publishEvent);

router.patch(
  '/:eventId',
  validationMiddleware.validateUpdateEvent,
  eventController.updateEvent
);

router.delete('/:eventId', eventController.deleteEvent);

// Event analytics
router.get('/:eventId/analytics', eventController.getEventAnalytics);

module.exports = router;