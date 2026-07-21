import ccxt, {Exchange} from 'ccxt'
import {config} from '../config.js'
import type {ExchangeId, Ticker} from '@nexttrade/shared'

const exchanges = new Map<string, Exchange>()

// ─── 代理配置（国内访问交易所必需）───
const proxyOptions = config.HTTPS_PROXY ? {httpsProxy: config.HTTPS_PROXY} : {}

function getExchange(id: ExchangeId): Exchange {
  const key = `${id}-default`
  if (exchanges.has(key)) return exchanges.get(key)!

  let exchange: Exchange
  switch (id) {
    case 'binance':
      exchange = new ccxt.binance({
        apiKey: config.BINANCE_API_KEY,
        secret: config.BINANCE_SECRET,
        ...proxyOptions
      })
      break
    case 'okx':
      exchange = new ccxt.okx({
        apiKey: config.OKX_API_KEY,
        secret: config.OKX_SECRET,
        password: config.OKX_PASSPHRASE,
        ...proxyOptions
      })
      break
    default:
      throw new Error(`Unsupported exchange: ${id}`)
  }

  exchanges.set(key, exchange)
  return exchange
}

export async function fetchTicker(
  exchangeId: ExchangeId,
  symbol: string
): Promise<Ticker> {
  const ex = getExchange(exchangeId)
  const ticker = await ex.fetchTicker(symbol)

  return {
    exchange: exchangeId,
    symbol: ticker.symbol,
    price: ticker.last ?? 0,
    change24h: ticker.percentage ?? 0,
    volume24h: ticker.baseVolume ?? 0,
    high24h: ticker.high ?? 0,
    low24h: ticker.low ?? 0,
    timestamp: ticker.timestamp ?? Date.now()
  }
}

export async function createOrder(
  exchangeId: ExchangeId,
  symbol: string,
  side: 'buy' | 'sell',
  type: 'market' | 'limit',
  amount: number,
  price?: number
) {
  const ex = getExchange(exchangeId)
  const order = await ex.createOrder(symbol, type, side, amount, price)
  return order
}

/**
 * 校验交易所 API Key 的有效性（委托给 validator 模块）
 */
export async function validateCredentials(
  exchangeId: string,
  credentials: {apiKey: string; apiSecret: string}
): Promise<{valid: boolean; error?: string}> {
  const {validateExchangeKey} = await import('./exchange/validator.js')
  const result = await validateExchangeKey(exchangeId, credentials)
  return {valid: result.valid, error: result.error}
}

export {getExchange}
