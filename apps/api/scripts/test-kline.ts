/**
 * 测试 Binance SDK K线接口是否正常
 * 使用: cd apps/api && npx tsx scripts/test-kline.ts
 */
import {
  ConfigurationRestAPI,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL
} from '@binance/common'
import {DerivativesTradingUsdsFuturesRestAPI} from '@binance/derivatives-trading-usds-futures'

async function main() {
  const config = new ConfigurationRestAPI({
    apiKey: '',
    basePath: DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL,
    timeout: 15_000
  })
  const api = new DerivativesTradingUsdsFuturesRestAPI.RestAPI(config)

  // 1. 测试 exchangeInformation
  console.log('=== 测试 exchangeInformation ===')
  const infoRes = await api.exchangeInformation()
  const infoData =
    typeof infoRes.data === 'function'
      ? await (infoRes as any).data()
      : (infoRes as any).data
  const rawSymbols = (infoData?.symbols ?? []) as any[]
  console.log('总交易对数:', rawSymbols.length)

  // 打印第一条的所有字段名
  const first = rawSymbols[0]
  if (first) {
    console.log('第一条的所有 key:', Object.keys(first))
    console.log('第一条数据:', JSON.stringify(first, null, 2).slice(0, 500))
  }

  // 尝试用不同字段名过滤
  const usdtPerps = rawSymbols.filter(
    (s: any) =>
      s.contractType === 'PERPETUAL' &&
      s.quoteAsset === 'USDT' &&
      s.contractStatus === 'TRADING'
  )
  console.log(
    'USDT永续(original):',
    usdtPerps.length,
    usdtPerps
      .slice(0, 3)
      .map((s: any) => s.symbol)
      .join(', ')
  )

  // 看看是不是字段改成小写了
  if (usdtPerps.length === 0 && first) {
    const keys = Object.keys(first)
    // 尝试 snake_case 变体
    const samples = rawSymbols.slice(0, 50)
    const contractTypes = [
      ...new Set(
        samples.map((s: any) => s.contractType || s.contract_type || 'N/A')
      )
    ]
    const quoteAssets = [
      ...new Set(
        samples.map((s: any) => s.quoteAsset || s.quote_asset || 'N/A')
      )
    ]
    const statuses = [
      ...new Set(
        samples.map(
          (s: any) => s.contractStatus || s.contract_status || s.status || 'N/A'
        )
      )
    ]
    console.log('contractType 值:', contractTypes)
    console.log('quoteAsset 值:', quoteAssets)
    console.log('status 值:', statuses)
  }

  // 2. 测试 klineCandlestickData
  console.log('\n=== 测试 klineCandlestickData ===')
  const symbol = 'BTCUSDT'
  const dateUtc = new Date('2026-07-25T00:00:00.000Z')
  console.log('查询日期:', '2026-07-25', 'since:', dateUtc.getTime())

  const res = await api.klineCandlestickData({
    symbol,
    interval: '1d' as any,
    startTime: dateUtc.getTime(),
    limit: 1
  })

  const data =
    typeof res.data === 'function'
      ? await (res as any).data()
      : (res as any).data
  console.log('返回类型:', typeof data, Array.isArray(data))
  console.log('返回数据:', JSON.stringify(data).slice(0, 500))

  if (Array.isArray(data) && data.length > 0) {
    const c = data[0]
    console.log('\nK线解析:')
    console.log('  开盘时间:', new Date(c[0]).toISOString())
    console.log('  开盘价:', c[1])
    console.log('  最高价:', c[2])
    console.log('  最低价:', c[3])
    console.log('  收盘价:', c[4])
    console.log('  成交量:', c[5])
  } else {
    console.log('⚠ 返回空数据!')
  }

  // 3. 测试不带 apiKey 的请求
  console.log('\n=== 测试不带 apiKey ===')
  const config2 = new ConfigurationRestAPI({
    basePath: DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL,
    timeout: 15_000
  } as any)
  const api2 = new DerivativesTradingUsdsFuturesRestAPI.RestAPI(config2)
  try {
    const res2 = await api2.klineCandlestickData({
      symbol: 'BTCUSDT',
      interval: '1d' as any,
      startTime: dateUtc.getTime(),
      limit: 1
    })
    const data2 =
      typeof res2.data === 'function'
        ? await (res2 as any).data()
        : (res2 as any).data
    console.log(
      '无apiKey返回:',
      Array.isArray(data2) ? `${data2.length} 条` : typeof data2
    )
  } catch (e: any) {
    console.log('无apiKey错误:', e.message)
  }

  process.exit(0)
}

main()
