/**
 * 交易所 URL 配置 — 按 apiKey 的 isTestnet 字段切换主网/模拟盘
 *
 * 注意: Binance 已于 2024 年关闭合约测试网，请使用 Demo Trading API
 */
import {db} from '../../db/index.js'
import {apiKeys} from '../../db/schema.js'
import {eq} from 'drizzle-orm'

const MAINNET = {
  restBase: 'https://fapi.binance.com',
  wsPublic: 'wss://fstream.binance.com/public',
  wsMarket: 'wss://fstream.binance.com/market',
  wsPrivate: 'wss://fstream.binance.com/private'
}

// Binance 合约测试网（USDⓈ-M Futures）
const DEMO = {
  restBase: 'https://testnet.binancefuture.com',
  wsPublic: 'wss://stream.binancefuture.com/public',
  wsMarket: 'wss://stream.binancefuture.com/market',
  wsPrivate: 'wss://stream.binancefuture.com/private'
}

type Urls = typeof MAINNET

export function getUrlsForDemo(): Urls {
  return DEMO
}

/** 按 apiKeyId 查 isTestnet 字段获取对应网络 URL */
export async function getUrls(apiKeyId: number): Promise<Urls> {
  try {
    const [key] = await db
      .select({isTestnet: apiKeys.isTestnet})
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId))
      .limit(1)
    if (key?.isTestnet) return DEMO
  } catch {}
  return MAINNET
}

/** 同步版本（默认主网，用于不绑定 Key 的场景） */
export function getUrlsSync(): Urls {
  return MAINNET
}
