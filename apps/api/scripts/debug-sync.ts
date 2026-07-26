/**
 * 调试脚本：逐步骤查看同步得到了什么数据
 * 模拟 syncSymbol 逻辑：7天窗口 + fromId 翻页
 */
import 'dotenv/config'
import {db} from '../src/db/index.js'
import {apiKeys, trades} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'
import crypto from 'crypto'

const BASE = 'https://fapi.binance.com'

function sign(secret: string, qs: string) { return crypto.createHmac('sha256', secret).update(qs).digest('hex') }

async function signedGet(apiKey: string, secret: string, path: string, params: Record<string, unknown>) {
  const ts = Date.now()
  const qsParts = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qsParts.set(k, String(v))
  qsParts.set('recvWindow', '60000')
  qsParts.set('timestamp', String(ts))
  const qs = qsParts.toString()
  const sig = sign(secret, qs)
  const res = await fetch(`${BASE}${path}?${qs}&signature=${sig}`, {headers: {'X-MBX-APIKEY': apiKey}})
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function main() {
  const keyId = parseInt(process.argv[2] || '2')
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1)
  if (!key) { console.log('❌ no key', keyId); return }
  const apiKey = key.apiKey, secret = decrypt(key.secretEnc)
  console.log('Key:', keyId, 'Label:', key.accountLabel)

  // 1. 获取当前持仓
  console.log('\n=== 1. 当前持仓 ===')
  const account = await signedGet(apiKey, secret, '/fapi/v2/account', {})
  const positions = (account.positions ?? []).filter((p: any) => parseFloat(p.positionAmt) !== 0)
  console.log('持仓数量:', positions.length)
  for (const p of positions) console.log(`  ${p.symbol}: ${p.positionAmt} @ ${p.entryPrice}`)

  const symbols = positions.length > 0 ? positions.map((p: any) => p.symbol).sort() : ['BTCUSDT', 'ETHUSDT']

  // 2. 测试 fromId 翻页机制
  console.log('\n=== 2. fromId 翻页测试 ===')
  for (const sym of symbols.slice(0, 2)) {
    console.log(`\n--- ${sym} ---`)
    let fromId: number | undefined
    let page = 0
    for (let windowDay = -30; windowDay < 0; windowDay += 7) {
      const ws = Date.now() + windowDay * 24 * 60 * 60 * 1000
      const we = ws + 7 * 24 * 60 * 60 * 1000
      console.log(`\n[窗口 ${new Date(ws).toISOString().slice(0, 10)} ~ ${new Date(we).toISOString().slice(0, 10)}]`)
      page = 0
      fromId = undefined
      while (page < 10) {
        const params: Record<string, unknown> = {symbol: sym, limit: 1000}
        if (fromId) params.fromId = fromId
        else { params.startTime = ws; params.endTime = we }
        const rows: any[] = await signedGet(apiKey, secret, '/fapi/v1/userTrades', params)
        console.log(`  第${page+1}页: fromId=${fromId ?? '无'}, 返回${rows.length}条`)
        if (rows.length === 0) break
        for (const r of rows) console.log(`    tradeId=${r.id} time=${new Date(r.time).toISOString().slice(0, 19)} side=${r.side} ps=${r.positionSide} qty=${r.qty} pnl=${r.realizedPnl}`)
        if (rows.length < 1000) break
        fromId = rows[rows.length - 1].id
        page++
      }
    }
  }

  // 3. DB 现有数据
  console.log('\n=== 3. DB trades 表 ===')
  const records = await db.select().from(trades).where(eq(trades.apiKeyId, keyId)).limit(10)
  console.log('记录数:', records.length)
  for (const r of records) console.log(`  id=${r.id} symbol=${r.symbol} side=${r.side} price=${r.price} time=${r.executedAt}`)

  // 4. DB positions 表
  const {positions: posTable} = await import('../src/db/schema.js')
  const pos = await db.select().from(posTable).where(eq(posTable.apiKeyId, keyId)).limit(10)
  console.log('\n=== 4. DB positions 表 ===')
  console.log('记录数:', pos.length)
  for (const p of pos) console.log(`  ${p.symbol} ${p.positionSide} ${p.status} entry=${p.entryPrice} pnl=${p.realizedPnl}`)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
