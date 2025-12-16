const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const redisClient = require('../config/redis');

const authMiddleware = {
  // Verify JWT token
  verifyToken: (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Access token is required'
      });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = decoded.userId;
      req.userRole = decoded.role;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          status: 'error',
          message: 'Token has expired'
        });
      }
      
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token'
      });
    }
  },

  // Verify host role
  verifyHost: (req, res, next) => {
    if (req.userRole !== 'host') {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Host role required.'
      });
    }
    next();
  },

  // Verify refresh token
  verifyRefreshToken: async (req, res, next) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        status: 'error',
        message: 'Refresh token is required'
      });
    }

    try {
      // Check if token is blacklisted
      const isBlacklisted = await redisClient.get(`blacklist:${refreshToken}`);
      if (isBlacklisted) {
        return res.status(401).json({
          status: 'error',
          message: 'Refresh token has been invalidated'
        });
      }

      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      
      // Find user and verify token
      const user = await User.findOne({
        _id: decoded.userId,
        'refreshTokens.token': refreshToken,
        status: 'active'
      });

      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'Invalid refresh token'
        });
      }

      // Check if token is expired
      const tokenData = user.refreshTokens.find(rt => rt.token === refreshToken);
      if (new Date() > tokenData.expiresAt) {
        // Remove expired token
        await user.removeRefreshToken(refreshToken);
        return res.status(401).json({
          status: 'error',
          message: 'Refresh token has expired'
        });
      }

      req.userId = decoded.userId;
      req.userRole = decoded.role;
      req.refreshToken = refreshToken;
      next();
    } catch (error) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid refresh token'
      });
    }
  },

  // Optional authentication (for public endpoints)
  optionalAuth: (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        req.userRole = decoded.role;
        req.isAuthenticated = true;
      } catch (error) {
        // Token is invalid but we continue without authentication
        req.isAuthenticated = false;
      }
    } else {
      req.isAuthenticated = false;
    }
    
    next();
  },

  // Rate limiting for authentication endpoints
  loginRateLimit: async (req, res, next) => {
    const ip = req.ip;
    const key = `login_attempts:${ip}`;
    
    try {
      const attempts = await redisClient.get(key);
      
      if (attempts && parseInt(attempts) >= 5) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many login attempts. Please try again in 15 minutes.'
        });
      }
      
      await redisClient.multi()
        .incr(key)
        .expire(key, 900) // 15 minutes
        .exec();
      
      next();
    } catch (error) {
      console.error('Rate limit error:', error);
      next();
    }
  },

  // Check if user is event host
  isEventHost: async (req, res, next) => {
    try {
      const { eventId } = req.params;
      const Event = require('../models/event.model');
      
      const event = await Event.findOne({
        _id: eventId,
        hostId: req.userId
      });
      
      if (!event) {
        return res.status(403).json({
          status: 'error',
          message: 'You are not the host of this event'
        });
      }
      
      req.event = event;
      next();
    } catch (error) {
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  }
};

module.exports = authMiddleware;