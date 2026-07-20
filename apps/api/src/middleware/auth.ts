import type {Context, Next} from 'hono'
import {verifyToken} from '../services/auth.js'

/**
 * JWT Bearer 鉴权中间件 (jose)
 *
 * 从 Authorization header 解析 JWT，将 userId / username 注入 context
 * 所有需要登录的接口都应使用此中间件
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({success: false, error: 'Unauthorized'}, 401)
  }

  const token = authHeader.slice(7)
  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({success: false, error: 'Invalid or expired token'}, 401)
  }

  // attach user info
  c.set('userId', payload.userId)
  c.set('username', payload.username)
  await next()
}
