import type {Context, Next} from 'hono'
import {RateLimiterRedis} from 'rate-limiter-flexible'
import {redis} from '../services/redis.js'

/**
 * 登录 / 注册 限流中间件
 *
 * - 每 IP 每 15 分钟最多 10 次尝试
 * - 超出返回 429 Too Many Requests
 * - Redis 不可用时降级为无限制
 */
const loginLimiter = new RateLimiterRedis({
  storeClient: redis as any,
  keyPrefix: 'rl:auth:',
  points: 10, // 最多 10 次
  duration: 15 * 60, // 每 15 分钟
  blockDuration: 15 * 60 // 超限后封禁 15 分钟
})

/**
 * 通用 API 限流（其他敏感接口）
 * 每 IP 每分钟 30 次
 */
const apiLimiter = new RateLimiterRedis({
  storeClient: redis as any,
  keyPrefix: 'rl:api:',
  points: 30,
  duration: 60,
  blockDuration: 60
})

/**
 * 认证接口限流（用于 /api/auth/*）
 */
export async function authRateLimit(c: Context, next: Next) {
  if (redis.status !== 'ready') {
    // Redis 不可用时跳过限流（降级）
    return next()
  }

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'

  try {
    await loginLimiter.consume(ip)
    await next()
  } catch {
    return c.json(
      {
        success: false,
        error: 'Too many requests. Please try again in 15 minutes.'
      },
      429
    )
  }
}

/**
 * 通用 API 限流
 */
export async function apiRateLimit(c: Context, next: Next) {
  if (redis.status !== 'ready') {
    return next()
  }

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown'

  try {
    await apiLimiter.consume(ip)
    await next()
  } catch {
    return c.json(
      {
        success: false,
        error: 'Too many requests. Please slow down.'
      },
      429
    )
  }
}
