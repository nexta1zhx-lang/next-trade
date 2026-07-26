import 'dotenv/config'
import {db} from '../src/db/index.js'
import {apiKeys} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'
import crypto from 'crypto'

const BASE = 'https://fapi.binance.com'
function sign(s: string, q: string) { return crypto.createHmac('sha256', s).update(q).digest('hex') }

async function get(ak: string, sk: string, path: string, p: Record<string, unknown>) {
  const ts = Date.now(); const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) qp.set(k, String(v))
  qp.set('recvWindow','60000'); qp.set('timestamp',String(ts))
  const q = qp.toString(); const sig = sign(sk, q)
  const r = await fetch(`${BASE}${path}?${q}&signature=${sig}`, {headers:{'X-MBX-APIKEY': ak}})
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,200)}`)
  return r.json()
}

async function main() {
  for (const kid of [3, 2]) {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, kid)).limit(1)
    if (!key) continue
    const ak = key.apiKey, sk = decrypt(key.secretEnc)
    console.log(`\n========== Key ${kid} (${key.accountLabel}) ==========`)

    // 查当前持仓
    const acct = await get(ak, sk, '/fapi/v2/account', {})
    const pos = (acct.positions ?? []).filter((p: any) => parseFloat(p.positionAmt) !== 0)
    console.log('持仓:', pos.length)
    pos.forEach((p: any) => console.log(`  ${p.symbol} amt=${p.positionAmt}`))

    // 查7天窗口内所有币种的成交（无 startTime 默认返回最近7天）
    const syms = pos.length > 0 ? pos.map((p: any) => p.symbol) : ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','DOGEUSDT','XRPUSDT','ADAUSDT','AVAXUSDT']
    for (const sym of syms) {
      try {
        const rows: any[] = await get(ak, sk, '/fapi/v1/userTrades', {symbol: sym, limit: 5})
        if (rows.length > 0) console.log(`${sym}: ${rows.length}条, 最近: tradeId=${rows[0].id} time=${new Date(rows[0].time).toISOString().slice(0,10)}`)
      } catch (e: any) { console.log(`${sym}: error ${e.message.slice(0, 60)}`) }
    }
  }
  process.exit(0)
}
main()
