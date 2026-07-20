import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { fetchTicker } from '../services/exchange.js';
import type { ExchangeId } from '@nexttrade/shared';

const router = new Hono();

const querySchema = z.object({
  exchange: z.enum(['binance', 'okx']),
  symbol: z.string().min(1),
});

router.get('/', zValidator('query', querySchema), async (c) => {
  const { exchange, symbol } = c.req.valid('query');
  try {
    const ticker = await fetchTicker(exchange as ExchangeId, symbol);
    return c.json({ success: true, data: ticker });
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 502);
  }
});

export { router as tickerRouter };
