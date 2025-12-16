const Redis = require('redis');

class RedisClient {
  constructor() {
    this.client = null;
  }

  async connect() {
    try {
      this.client = Redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.log('Too many retries on Redis. Giving up.');
              return new Error('Too many retries');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected successfully');
      });

      this.client.on('ready', () => {
        console.log('✅ Redis ready for commands');
      });

      this.client.on('end', () => {
        console.log('🔌 Redis connection closed');
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      throw error;
    }
  }

  async get(key) {
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set(key, value, options = {}) {
    try {
      return await this.client.set(key, value, options);
    } catch (error) {
      console.error('Redis set error:', error);
      return null;
    }
  }

  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
      return null;
    }
  }

  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error('Redis exists error:', error);
      return false;
    }
  }

  async expire(key, seconds) {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      console.error('Redis expire error:', error);
      return false;
    }
  }

  async hSet(key, field, value) {
    try {
      return await this.client.hSet(key, field, value);
    } catch (error) {
      console.error('Redis hSet error:', error);
      return false;
    }
  }

  async hGet(key, field) {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      console.error('Redis hGet error:', error);
      return null;
    }
  }

  async lPush(key, value) {
    try {
      return await this.client.lPush(key, value);
    } catch (error) {
      console.error('Redis lPush error:', error);
      return false;
    }
  }

  async lRange(key, start, stop) {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      console.error('Redis lRange error:', error);
      return [];
    }
  }

  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      console.error('Redis incr error:', error);
      return null;
    }
  }

  async quit() {
    try {
      await this.client.quit();
    } catch (error) {
      console.error('Redis quit error:', error);
    }
  }
}

module.exports = new RedisClient();