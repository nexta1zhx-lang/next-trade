/**
 * 测试脚本：调试历史成交采集接口
 * 1. 测试 exchangeInfo 返回格式
 * 2. 测试 userTrades 返回格式
 * 3. 验证数据写入 trades 表
 */
import 'dotenv/config'
import {DerivativesTradingUsdsFutures} from '@binance/derivatives-trading-usds-futures'
import {db} from '../src/db/index.js'
import {apiKeys, trades} from '../src/db/schema.js'
import {eq, sql} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'

async function main() {
  // 1. 获取第一个 ACTIVE Binance Key
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.exchangeId, 'binance'))
    .limit(1)

  if (!key) {
    console.log('❌ 没有 Binance Key')
    return
  }

  const apiKey = key.apiKey
  const secret = decrypt(key.secretEnc)
  console.log('Key ID:', key.id, 'Label:', key.accountLabel)

  const client = new DerivativesTradingUsdsFutures({
    configurationRestAPI: {apiKey, apiSecret: secret, timeout: 10000}
  })

  // 2. 直接用 fetch + HMAC 签名测试
  console.log('\n--- 1. 原生 fetch 测试 ---')
  const ts = Date.now()
  const hmac = (await import('crypto')).default.createHmac('sha256', secret)

  // 测试 exchangeInfo（公开接口）
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')
    const json = (await res.json()) as any
    console.log('exchangeInfo symbols:', json?.symbols?.length ?? 0)
    if (json?.symbols?.length > 0) {
      const filtered = json.symbols.filter(
        (s: any) =>
          s.contractType === 'PERPETUAL' &&
          s.quoteAsset === 'USDT' &&
          s.status === 'TRADING'
      )
      console.log(
        'USDT perpetual:',
        filtered.length,
        'first:',
        filtered[0]?.symbol
      )
    }
  } catch (err: any) {
    console.log('❌ exchangeInfo failed:', err.message)
  }

  // 测试 userTrades（需签名）
  try {
    const qs = `symbol=BTCUSDT&limit=2&recvWindow=60000&timestamp=${ts}`
    const signature = hmac.update(qs).digest('hex')
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/userTrades?${qs}&signature=${signature}`,
      {
        headers: {'X-MBX-APIKEY': apiKey}
      }
    )
    const json = (await res.json()) as any
    console.log('\nuserTrades status:', res.status)
    console.log('isArray:', Array.isArray(json))
    console.log(
      'count:',
      Array.isArray(json) ? json.length : JSON.stringify(json).slice(0, 300)
    )
    if (Array.isArray(json) && json.length > 0) {
      console.log('first trade:', JSON.stringify(json[0], null, 2))
    }
  } catch (err: any) {
    console.log('❌ userTrades failed:', err.message)
  }

  // 3. 获取第一个 USDT 永续合约的 symbol
  let testSymbol = 'BTCUSDT'
  try {
    const info = await client.restAPI.sendRequest<any>(
      '/fapi/v1/exchangeInfo',
      'GET'
    )
    const symbols = ((info.data as any)?.symbols ?? []) as any[]
    const perpSymbols = symbols.filter(
      (s: any) =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING'
    )
    if (perpSymbols.length > 0) testSymbol = perpSymbols[0].symbol
  } catch {}

  // 4. 测试 userTrades
  console.log(`\n--- 2. userTrades (${testSymbol}) ---`)
  const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000

  try {
    const resp = await client.restAPI.sendSignedRequest<any>(
      '/fapi/v1/userTrades',
      'GET',
      {symbol: testSymbol, limit: 3, recvWindow: 60000}
    )
    console.log('resp keys:', Object.keys(resp))
    console.log('resp.data type:', typeof resp.data)
    const actual = typeof resp.data === 'function' ? resp.data() : resp.data
    console.log('actual first 500:', JSON.stringify(actual)?.slice(0, 500))
  } catch (err: any) {
    console.log('❌ userTrades failed:', err.message)
  }

  // 5. 测试写入 trades 表
  console.log('\n--- 3. 测试写入 ---')
  const beforeCount = await db.select({c: sql`count(*)`}).from(trades)
  console.log('trades 表已有记录数:', beforeCount[0]?.c)

  // 测试插入
  try {
    await db
      .insert(trades)
      .values({
        apiKeyId: key.id,
        tradeId: 'test-' + Date.now(),
        symbol: testSymbol,
        marketType: 'PERP',
        side: 'OPEN_LONG',
        price: '50000',
        amount: '0.001',
        quoteQty: '50',
        executedAt: new Date()
      })
      .onConflictDoNothing()
    console.log('✅ 写入测试成功')

    // 清理
    await db.delete(trades).where(eq(trades.tradeId, 'test-' + Date.now()))
  } catch (err: any) {
    console.log('❌ 写入失败:', err.message)
  }

  console.log('\n✅ 测试完成')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
