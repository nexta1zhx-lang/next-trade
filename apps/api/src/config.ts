import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://localhost:5432/nexttrade'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev-secret'),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_SECRET: z.string().optional(),
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
