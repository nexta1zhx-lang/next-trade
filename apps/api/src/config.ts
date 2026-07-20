import {config as dotenv} from 'dotenv'
import {resolve} from 'path'
import {fileURLToPath} from 'url'

// 在模块加载时优先加载 .env，确保所有 import 都能读到环境变量
dotenv({path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../.env')})

import {z} from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z
    .string()
    .default('postgres://nexttrade:nexttrade@localhost:5432/nexttrade'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev-secret'),

  // AES-256-GCM 加密密钥（必须 32 字节 hex，生产环境务必更换）
  ENCRYPTION_KEY: z
    .string()
    .default(
      '0000000000000000000000000000000000000000000000000000000000000000'
    ),

  // 可选交易所全局 Key
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_SECRET: z.string().optional(),
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  HTTPS_PROXY: z.string().optional() // 国内环境代理，如 http://127.0.0.1:7890
})

export const config = envSchema.parse(process.env)
export type Config = z.infer<typeof envSchema>
