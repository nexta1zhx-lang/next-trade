import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {config} from '../config.js'

/**
 * AES-256-GCM 对称加密工具
 *
 * 用于加密数据库中存储的 Binance API Key / Secret
 * 密钥 ENCRYPTION_KEY 从环境变量读取，必须为 64 字符 hex（32 字节）
 *
 * 密文格式: iv:authTag:ciphertext (均为 hex)
 */
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // GCM 推荐 12 或 16 字节
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const hex = config.ENCRYPTION_KEY
  if (hex.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex chars (32 bytes), got ${hex.length}`
    )
  }
  return Buffer.from(hex, 'hex')
}

/**
 * 加密明文
 * @returns "hex(iv):hex(authTag):hex(ciphertext)"
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * 解密密文
 * @param encoded "hex(iv):hex(authTag):hex(ciphertext)"
 * @returns 明文字符串
 */
export function decrypt(encoded: string): string {
  const key = getKey()

  const parts = encoded.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:authTag:ciphertext')
  }

  const [ivHex, authTagHex, ciphertext] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * 遮掩 API Key 中间部分（用于前端显示）
 * "abc123def456" → "abc1****f456"
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 4)}****`
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}
