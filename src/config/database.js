const mongoose = require('mongoose');
const Redis = require('redis');

class Database {
  constructor() {
    this.mongoose = mongoose;
    this.redisClient = null;
  }

  async connectMongoDB() {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      console.log('✅ MongoDB connected successfully');
      
      // Connection events
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.log('🔌 MongoDB disconnected');
      });
      
      process.on('SIGINT', async () => {
        await mongoose.connection.close();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      process.exit(1);
    }
  }

  async connectRedis() {
    try {
      this.redisClient = Redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
        }
      });

      this.redisClient.on('error', (err) => {
        console.error('❌ Redis Client Error:', err);
      });

      this.redisClient.on('connect', () => {
        console.log('✅ Redis connected successfully');
      });

      await this.redisClient.connect();
      return this.redisClient;
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      await mongoose.connection.close();
      console.log('🔌 All database connections closed');
    } catch (error) {
      console.error('Error disconnecting databases:', error);
    }
  }
}

module.exports = new Database();