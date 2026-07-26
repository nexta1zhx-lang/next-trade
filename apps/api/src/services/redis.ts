import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    // 无限重试，避免因 Redis 不可用导致进程崩溃
    return Math.min(times * 200, 5000);
  },
});

// 捕获错误避免 unhandled error event 崩溃进程
redis.on('error', err => {
  console.warn('[redis] connection error:', err.message);
});
