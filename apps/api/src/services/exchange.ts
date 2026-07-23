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

let binanceFuture: InstanceType<typeof ccxt.binance> | null = null
let loadingFuture: Promise<InstanceType<typeof ccxt.binance>> | null = null

/**
 * 获取共享的 Binance USDT 永续合约交易所实例
 * 复用 loadMarkets 避免每次请求都拉取全量市场数据
 */
export async function getBinanceFuture(): Promise<
  InstanceType<typeof ccxt.binance>
> {
  if (binanceFuture) return binanceFuture
  if (loadingFuture) return loadingFuture

  loadingFuture = (async () => {
    const ex = new ccxt.binance({
      enableRateLimit: true,
      timeout: 30000,
      options: {defaultType: 'swap'}
    })
    if (config.HTTPS_PROXY) {
      ex.httpsProxy = config.HTTPS_PROXY
    }
    await ex.loadMarkets()
    binanceFuture = ex
    loadingFuture = null
    return ex
  })()

  return loadingFuture
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
