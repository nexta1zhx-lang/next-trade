import ccxt from 'ccxt'
import {ATR, BollingerBands, SMA} from 'technicalindicators'
import {config} from '../config.js'
import {getConfig} from './configService.js'
import type {WatchlistItem} from '@nexttrade/shared'

const EXCLUDED_BASES = new Set([
  'USDT',
  'USDC',
  'BUSD',
  'DAI',
  'FDUSD',
  'TUSD',
  'USDP',
  'GYEN',
  'PAX',
  'USTC'
])

interface MarketMeta {
  id: string
  symbol: string
  base: string
  quote: string
  active: boolean
  swap: boolean
  linear: boolean
}

interface Candle {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface Candidate {
  symbol: string
  base: string
  high: number
  low: number
  close: number
  volume: number
  amplitude: number
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: number | undefined | null): number {
  return v ?? 0
}

function isLeveragedToken(base: string): boolean {
  const up = base.toUpperCase()
  // 3L/3S, BULL/BEAR, UP/DOWN, BLZ 等杠杆代币
  if (/[0-9](L|S)$/.test(up)) return true
  if (up.includes('BULL') || up.includes('BEAR')) return true
  if (up.includes('UP') || up.includes('DOWN')) return true
  if (up === 'BLZ') return true
  return false
}

/**
 * PA 过滤器：获取候选标的列表（按振幅+成交额评分）
 */
export async function getCandidates(cfg?: {
  minQuoteVolume?: number
  topCandidates?: number
}): Promise<Candidate[]> {
  const conf = await getConfig()
  const minVol = cfg?.minQuoteVolume ?? conf.minQuoteVolume
  const topN = cfg?.topCandidates ?? conf.topCandidates
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    timeout: 30000,
    options: {defaultType: 'future'}
  })

  if (config.HTTPS_PROXY) {
    await exchange.loadProxyModules()
    exchange.httpsProxy = config.HTTPS_PROXY
  }

  await exchange.loadMarkets()
  const allMarkets = Object.values(exchange.markets) as MarketMeta[]
  const markets = allMarkets.filter(
    m => m.active && m.swap && m.linear && m.quote === 'USDT'
  )
  const symbolToMarket = new Map(markets.map(m => [m.id, m]))

  const tickers = await exchange.fetchTickers()
  if (!tickers) throw new Error('fetchTickers returned null')

  const candidates: Candidate[] = []

  for (const [id, t] of Object.entries(tickers)) {
    const market = symbolToMarket.get(id)
    if (!market) continue

    const base = market.base.toUpperCase()
    if (EXCLUDED_BASES.has(base) || isLeveragedToken(base)) continue

    const close = num(t.last ?? t.close)
    const high = num(t.high)
    const low = num(t.low)
    const baseVolume = num(t.baseVolume)
    const quoteVolume = close * baseVolume

    if (quoteVolume < minVol) continue
    if (low === 0 || close === 0) continue

    const amplitude = ((high - low) / low) * 100

    candidates.push({
      symbol: market.symbol,
      base: market.base,
      close: r2(close),
      high: r2(high),
      low: r2(low),
      volume: quoteVolume,
      amplitude: r2(amplitude)
    })
  }

  // 综合评分：振幅排名 × 0.4 + 成交额排名 × 0.3
  candidates.sort((a, b) => b.amplitude - a.amplitude)
  candidates.forEach((c, i) => Object.assign(c, {rankAmp: i}))

  candidates.sort((a, b) => b.volume - a.volume)
  candidates.forEach((c, i) => Object.assign(c, {rankVol: i}))

  candidates.sort((a, b) => {
    const sa = (a as any).rankAmp * 0.4 + (a as any).rankVol * 0.3
    const sb = (b as any).rankAmp * 0.4 + (b as any).rankVol * 0.3
    return sa - sb
  })

  return candidates.slice(0, topN)
}

/**
 * 计算 Squeeze 状态
 * 对每个候选标的拉取 15m K 线，计算 ATR、布林带、肯特纳通道宽度
 */
export async function calculateSqueeze(
  candidates: Candidate[],
  cfg?: {
    atrPeriod?: number
    bbPeriod?: number
    bbStdDev?: number
    kcPeriod?: number
    kcAtrMultiplier?: number
    topFinal?: number
  }
): Promise<(Candidate & {isSqueeze: boolean; atr: number})[]> {
  const conf = await getConfig()
  const atrPeriod = cfg?.atrPeriod ?? conf.atrPeriod
  const bbPeriod = cfg?.bbPeriod ?? conf.bbPeriod
  const bbStdDev = cfg?.bbStdDev ?? conf.bbStdDev
  const kcPeriod = cfg?.kcPeriod ?? conf.kcPeriod
  const kcMultiplier = cfg?.kcAtrMultiplier ?? conf.kcAtrMultiplier
  const topN = cfg?.topFinal ?? conf.topFinal
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    timeout: 30000,
    options: {defaultType: 'future'}
  })

  if (config.HTTPS_PROXY) {
    await exchange.loadProxyModules()
    exchange.httpsProxy = config.HTTPS_PROXY
  }

  const results: (Candidate & {isSqueeze: boolean; atr: number})[] = []
  const batchSize = 10

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize)
    const promises = batch.map(async c => {
      try {
        const id = c.symbol.split(':')[0].replace('/', '')
        const ohlcv = await exchange.fetchOHLCV(id, '15m', undefined, 96)
        if (!ohlcv || ohlcv.length < 30) {
          return {...c, isSqueeze: false, atr: 0}
        }

        const candles: Candle[] = ohlcv.map(k => ({
          open: k[1] ?? 0,
          high: k[2] ?? 0,
          low: k[3] ?? 0,
          close: k[4] ?? 0,
          volume: k[5] ?? 0
        }))

        const closes = candles.map(x => x.close)
        const highs = candles.map(x => x.high)
        const lows = candles.map(x => x.low)

        // ATR
        const atrResult = ATR.calculate({
          high: highs,
          low: lows,
          close: closes,
          period: atrPeriod
        })
        const atr = atrResult.length > 0 ? atrResult[atrResult.length - 1] : 0

        // Bollinger Bands
        const bb = BollingerBands.calculate({
          period: bbPeriod,
          values: closes,
          stdDev: bbStdDev
        })
        const lastBb = bb[bb.length - 1]
        const bbWidth = lastBb
          ? (lastBb.upper - lastBb.lower) / (lastBb.middle || 1)
          : 0

        // Keltner Channel — 用 SMA 做中轨
        const sma = SMA.calculate({period: kcPeriod, values: closes})
        const kcMiddle = sma[sma.length - 1] || closes[closes.length - 1]
        const kcWidth = (2 * atr * kcMultiplier) / (kcMiddle || 1)

        // Squeeze: BBwidth < KCwidth
        const isSqueeze = bbWidth < kcWidth

        return {...c, isSqueeze, atr: r2(atr)}
      } catch {
        return {...c, isSqueeze: false, atr: 0}
      }
    })

    const batchResults = await Promise.all(promises)
    results.push(...batchResults)
  }

  // 综合评分排序：振幅排名 × 0.4 + 成交额排名 × 0.3 + squeeze × 0.3
  results.sort((a, b) => b.amplitude - a.amplitude)
  results.forEach((c, i) => Object.assign(c, {rankAmp: i}))
  results.sort((a, b) => b.volume - a.volume)
  results.forEach((c, i) => Object.assign(c, {rankVol: i}))

  const maxRank = results.length
  results.sort((a, b) => {
    const sa =
      ((maxRank - (a as any).rankAmp) / maxRank) * 0.4 +
      ((maxRank - (a as any).rankVol) / maxRank) * 0.3 +
      (a.isSqueeze ? 1 : 0) * 0.3
    const sb =
      ((maxRank - (b as any).rankAmp) / maxRank) * 0.4 +
      ((maxRank - (b as any).rankVol) / maxRank) * 0.3 +
      (b.isSqueeze ? 1 : 0) * 0.3
    return sb - sa
  })

  return results.slice(0, topN)
}
