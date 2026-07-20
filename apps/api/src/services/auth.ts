import {SignJWT, jwtVerify, type JWTPayload} from 'jose'
import * as argon2 from 'argon2'
import {config} from '../config.js'

// ─── JWT ───

const JWT_ISSUER = 'nexttrade'
const JWT_AUDIENCE = 'nexttrade-api'

/** 从环境变量生成 HMAC SHA256 密钥 */
function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET)
}

export interface JwtClaims extends JWTPayload {
  userId: number
  username: string
}

/**
 * 签发访问令牌（7 天有效期）
 */
export async function signToken(payload: {
  userId: number
  username: string
}): Promise<string> {
  const secret = getJwtSecret()

  return new SignJWT({...payload} as unknown as JWTPayload)
    .setProtectedHeader({alg: 'HS256', typ: 'JWT'})
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

/**
 * 验证并解码 JWT
 */
export async function verifyToken(token: string): Promise<JwtClaims | null> {
  try {
    const secret = getJwtSecret()
    const {payload} = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    })

    if (
      typeof payload.userId !== 'number' ||
      typeof payload.username !== 'string'
    ) {
      return null
    }

    return payload as unknown as JwtClaims
  } catch {
    return null
  }
}

// ─── 密码哈希 (argon2id) ───

/**
 * 使用 argon2id 对密码进行哈希
 * 自动生成随机盐，结果可安全存储在数据库中
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MB
    timeCost: 2, // 2 次迭代
    parallelism: 1 // 单线程
  })
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
