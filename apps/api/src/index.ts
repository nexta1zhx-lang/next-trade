import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { redis } from './services/redis.js';
import { tickerRouter } from './routes/ticker.js';
import { orderRouter } from './routes/order.js';

const app = new Hono();

// ─── 全局中间件 ───
app.use('*', cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use('*', logger());

// ─── 健康检查 ───
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// ─── 路由 ───
app.route('/api/ticker', tickerRouter);
app.route('/api/orders', orderRouter);

// ─── 启动 ───
async function main() {
  // 连接 Redis
  try {
    await redis.connect();
    console.log('✓ Redis connected');
  } catch {
    console.warn('⚠ Redis unavailable, running without cache');
  }

  serve(
    { fetch: app.fetch, port: config.PORT },
    (info: { port: number }) => console.log(`✓ API running on http://localhost:${info.port}`),
  );
}

main();
