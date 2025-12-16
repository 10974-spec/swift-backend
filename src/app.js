require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Redis = require('redis');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const http = require('http');

// Import routes
const authRoutes = require('./routes/auth.routes');
const hostRoutes = require('./routes/host.routes');
const eventRoutes = require('./routes/events.routes');
const checkoutRoutes = require('./routes/checkout.routes');
const paymentRoutes = require('./routes/payment.routes');
const ticketRoutes = require('./routes/ticket.routes');

// Import middleware
const { errorHandler } = require('./middlewares/error.middleware');
const { requestLogger } = require('./middlewares/logger.middleware');

// Initialize Express
const app = express();
const server = http.createServer(app);

// Initialize Redis client
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Global middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(mongoSanitize());
app.use(xss());
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api', limiter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'SwiftPass API is running',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redisClient.isReady ? 'connected' : 'disconnected'
    }
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/host', hostRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/tickets', ticketRoutes);

// 404 handler
app.all('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

// Error handling middleware
app.use(errorHandler);

// Connect to MongoDB
const connectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/swiftpass', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    logger.info('Connected to MongoDB successfully');
    
    // Connection events
    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.info('🔌 MongoDB disconnected');
    });
    
    return true;
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    return false;
  }
};

// Connect to Redis
const connectRedis = async () => {
  try {
    await redisClient.connect();
    logger.info('Connected to Redis successfully');
    return true;
  } catch (error) {
    logger.error('Redis connection error:', error);
    return false;
  }
};

// Start server
const startServer = async () => {
  try {
    // Connect to databases
    const mongoConnected = await connectMongoDB();
    const redisConnected = await connectRedis();
    
    if (!mongoConnected || !redisConnected) {
      logger.error('Failed to connect to databases. Exiting...');
      process.exit(1);
    }
    
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      
      // Initialize background jobs after a delay
      setTimeout(() => {
        try {
          require('./jobs/payout.job');
          require('./jobs/ticket-activation.job');
          require('./jobs/ticket-generation.job');
          logger.info('Background jobs initialized');
        } catch (error) {
          logger.error('Error initializing background jobs:', error);
        }
      }, 3000);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      redisClient.quit();
      logger.info('Closed all connections');
      process.exit(0);
    });
  });
});

// Start the server
startServer();

module.exports = app;