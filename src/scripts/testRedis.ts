import { connectDatabase } from '../config/database.js';
import { redisService } from '../services/redis.service.js';
import mongoose from 'mongoose';

async function testRedis() {
  const key = 'test:rec:123';
  await redisService.setEx(key, 60, JSON.stringify({ hello: 'world' }));
  const t0 = performance.now();
  const val = await redisService.get(key);
  const elapsed = performance.now() - t0;
  console.log(`✅ Redis read: ${elapsed.toFixed(2)}ms, result:`, JSON.parse(val || '{}'));
  await redisService.del(key);
  process.exit(0);
}

testRedis().catch(e => { console.error(e); process.exit(1); });
