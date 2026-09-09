import { Redis } from 'ioredis';
import { env } from '../config/env.js';

class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private memoryFallback = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    try {
      this.client = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
        retryStrategy(times) {
          if (times > 3) return null; // Stop retrying after 3 attempts
          return Math.min(times * 200, 1000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('✅ Connected to Redis successfully');
      });

      this.client.on('error', (err) => {
        if (this.isConnected) {
          console.warn('⚠️ Redis connection error:', err.message);
        }
        this.isConnected = false;
      });
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      console.warn('⚠️ Failed to initialize Redis client. Falling back to in-memory store:', msg);
      this.client = null;
      this.isConnected = false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client && this.isConnected) {
      try {
        return await this.client.get(key);
      } catch {
        this.isConnected = false;
      }
    }
    // In-memory fallback
    const item = this.memoryFallback.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return item.value;
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.setex(key, seconds, value);
        return;
      } catch {
        this.isConnected = false;
      }
    }
    // In-memory fallback
    this.memoryFallback.set(key, {
      value,
      expiresAt: Date.now() + seconds * 1000,
    });
  }

  async setNx(key: string, seconds: number, value: string): Promise<boolean> {
    if (this.client && this.isConnected) {
      try {
        const res = await this.client.set(key, value, 'EX', seconds, 'NX');
        return res === 'OK';
      } catch {
        this.isConnected = false;
      }
    }
    // In-memory fallback
    const item = this.memoryFallback.get(key);
    if (item && Date.now() <= item.expiresAt) {
      return false;
    }
    this.memoryFallback.set(key, {
      value,
      expiresAt: Date.now() + seconds * 1000,
    });
    return true;
  }

  async incr(key: string, seconds: number): Promise<number> {
    if (this.client && this.isConnected) {
      try {
        const val = await this.client.incr(key);
        if (val === 1) {
          await this.client.expire(key, seconds);
        }
        return val;
      } catch {
        this.isConnected = false;
      }
    }
    // In-memory fallback
    const current = await this.get(key);
    const newVal = (current ? parseInt(current, 10) : 0) + 1;
    await this.setEx(key, seconds, String(newVal));
    return newVal;
  }

  async del(key: string): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.del(key);
        return;
      } catch {
        this.isConnected = false;
      }
    }
    this.memoryFallback.delete(key);
  }

  async getTtl(key: string): Promise<number> {
    if (this.client && this.isConnected) {
      try {
        return await this.client.ttl(key);
      } catch {
        this.isConnected = false;
      }
    }
    const item = this.memoryFallback.get(key);
    if (!item) return -2;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryFallback.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }
}

export const redisService = new RedisService();
