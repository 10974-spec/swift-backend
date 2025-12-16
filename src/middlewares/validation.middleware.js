const Joi = require('joi');

const validationSchemas = {
  // Auth validation
  register: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    phone: Joi.string().pattern(/^\+?[\d\s-]{10,}$/).required(),
    idNumber: Joi.string().required(),
    bankDetails: Joi.object({
      bankName: Joi.string().required(),
      accountNumber: Joi.string().required(),
      accountName: Joi.string().required(),
      branchCode: Joi.string().optional()
    }).required(),
    companyName: Joi.string().optional().allow('')
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  googleAuth: Joi.object({
    token: Joi.string().required()
  }),

  facebookAuth: Joi.object({
    token: Joi.string().required()
  }),

  // Event validation - FIXED: Use 'name' for tiers to match Mongoose model
  createEvent: Joi.object({
    eventName: Joi.string().min(3).max(200).required(),
    aboutText: Joi.string().min(50).max(5000).required(),
    category: Joi.string().valid(
      'concert', 'conference', 'workshop', 'festival', 'sports',
      'theater', 'exhibition', 'networking', 'party', 'other'
    ).required(),
    performers: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        occupation: Joi.string().required(),
        imageUrl: Joi.string().uri().optional(),
        description: Joi.string().optional()
      })
    ).optional(),
    location: Joi.object({
      venueName: Joi.string().required(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().default('Kenya'),
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required()
    }).required(),
    tiers: Joi.array().items(
      Joi.object({
        name: Joi.string().required(), // CHANGED: tierName -> name
        price: Joi.number().min(0).required(),
        quantityAvailable: Joi.number().min(1).max(100000).required(),
        description: Joi.string().optional(),
        benefits: Joi.array().items(Joi.string()).optional()
      })
    ).min(1).required(),
    eventDate: Joi.date().greater('now').required(),
    eventTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
    status: Joi.string().valid('draft', 'published').default('draft'),
    bannerUrl: Joi.string().uri().optional().allow('') // ADDED
  }),

  // Checkout validation - Keep tierName for checkout logic
  checkout: Joi.object({
    eventId: Joi.string().hex().length(24).required(),
    tickets: Joi.array().items(
      Joi.object({
        tierName: Joi.string().required(),
        quantity: Joi.number().min(1).max(20).required()
      })
    ).min(1).required(),
    buyerName: Joi.string().required(),
    buyerEmail: Joi.string().email().required(),
    buyerPhone: Joi.string().pattern(/^\+?[\d\s-]{10,}$/).required()
  }),

  // Payment validation
  initiatePayment: Joi.object({
    orderId: Joi.string().required(),
    phone: Joi.string().pattern(/^\+?[\d\s-]{10,}$/).required()
  }),

  // Ticket validation
  scanTicket: Joi.object({
    qrCodeId: Joi.string().required()
  }),

  // Host validation
  updateBankDetails: Joi.object({
    bankName: Joi.string().required(),
    accountNumber: Joi.string().required(),
    accountName: Joi.string().required(),
    branchCode: Joi.string().optional()
  }),

  // Update event validation
  updateEvent: Joi.object({
    eventName: Joi.string().min(3).max(200).optional(),
    aboutText: Joi.string().min(50).max(5000).optional(),
    category: Joi.string().valid(
      'concert', 'conference', 'workshop', 'festival', 'sports',
      'theater', 'exhibition', 'networking', 'party', 'other'
    ).optional(),
    performers: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        occupation: Joi.string().required(),
        imageUrl: Joi.string().uri().optional(),
        description: Joi.string().optional()
      })
    ).optional(),
    location: Joi.object({
      venueName: Joi.string().optional(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      country: Joi.string().default('Kenya'),
      lat: Joi.number().min(-90).max(90).optional(),
      lng: Joi.number().min(-180).max(180).optional()
    }).optional(),
    tiers: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        price: Joi.number().min(0).required(),
        quantityAvailable: Joi.number().min(1).max(100000).required(),
        description: Joi.string().optional(),
        benefits: Joi.array().items(Joi.string()).optional()
      })
    ).optional(),
    eventDate: Joi.date().greater('now').optional(),
    eventTime: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    status: Joi.string().valid('draft', 'published').optional(),
    bannerUrl: Joi.string().uri().optional().allow('')
  })
};

const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    // For event creation, handle both JSON and form-data
    if ((schema === validationSchemas.createEvent || schema === validationSchemas.updateEvent) && req.is('multipart/form-data')) {
      // Parse JSON strings from form-data
      const body = { ...req.body };
      
      // Parse performers if it's a string
      if (body.performers && typeof body.performers === 'string') {
        try {
          body.performers = JSON.parse(body.performers);
        } catch (error) {
          // If parsing fails, keep as is
        }
      }
      
      // Parse location if it's a string
      if (body.location && typeof body.location === 'string') {
        try {
          body.location = JSON.parse(body.location);
        } catch (error) {
          // If parsing fails, keep as is
        }
      }
      
      // Parse tiers if it's a string
      if (body.tiers && typeof body.tiers === 'string') {
        try {
          body.tiers = JSON.parse(body.tiers);
        } catch (error) {
          // If parsing fails, keep as is
        }
      }
      
      // Set the parsed body back to req
      req.body = body;
    }

    const { error } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, '')
      }));

      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors
      });
    }

    // Transform data for backward compatibility (tierName -> name)
    if (schema === validationSchemas.createEvent || schema === validationSchemas.updateEvent) {
      if (req.body.tiers && req.body.tiers.length > 0) {
        req.body.tiers = req.body.tiers.map(tier => ({
          name: tier.tierName || tier.name, // Support both
          price: tier.price,
          quantityAvailable: tier.quantityAvailable,
          description: tier.description || '',
          benefits: tier.benefits || []
        }));
      }
    }

    next();
  };
};

// Create middleware functions for each schema
const validationMiddleware = {};

Object.keys(validationSchemas).forEach(key => {
  validationMiddleware[`validate${key.charAt(0).toUpperCase() + key.slice(1)}`] = 
    validate(validationSchemas[key]);
});

module.exports = validationMiddleware;