import type { Context, Next } from 'hono';
import { config } from '../config.js';

/**
 * Simple JWT-like auth middleware.
 * In production, replace with NextAuth.js / Dynamic.xyz verification.
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  // TODO: verify JWT / SIWE token
  if (token !== config.JWT_SECRET && process.env.NODE_ENV === 'production') {
    return c.json({ success: false, error: 'Invalid token' }, 401);
  }

  // attach user info
  c.set('userId', 1);
  await next();
}
