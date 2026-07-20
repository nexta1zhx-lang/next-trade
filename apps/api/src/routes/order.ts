import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { createOrder } from '../services/exchange.js';
import { db } from '../db/index.js';
import { orders } from '../db/schema.js';
import type { ExchangeId } from '@nexttrade/shared';

const router = new Hono();

const createOrderSchema = z.object({
  exchange: z.enum(['binance', 'okx']),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  amount: z.number().positive(),
  price: z.number().positive().optional(),
});

router.post('/', zValidator('json', createOrderSchema), async (c) => {
  const body = c.req.valid('json');

  try {
    // 1. 下单到交易所
    const exchangeOrder = await createOrder(
      body.exchange as ExchangeId,
      body.symbol,
      body.side,
      body.type,
      body.amount,
      body.price,
    );

    // 2. 落库
    const [order] = await db.insert(orders).values({
      userId: 1, // TODO: from auth context
      exchange: body.exchange,
      exchangeOrderId: exchangeOrder.id,
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      price: body.price?.toString(),
      amount: body.amount.toString(),
      status: exchangeOrder.status ?? 'open',
    }).returning();

    return c.json({ success: true, data: order }, 201);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 502);
  }
});

router.get('/', async (c) => {
  const orderList = await db.select().from(orders).limit(50);
  return c.json({ success: true, data: orderList });
});

export { router as orderRouter };
