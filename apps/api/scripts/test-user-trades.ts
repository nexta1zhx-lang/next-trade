import 'dotenv/config'
import {db} from '../src/db/index.js'
import {apiKeys} from '../src/db/schema.js'
import {eq} from 'drizzle-orm'
import {decrypt} from '../src/services/crypto.js'
import crypto from 'crypto'

async function main() {
  // Test Key 2
  const key = (await db.select().from(apiKeys).where(eq(apiKeys.id, 2)).limit(1))[0]
  if (!key) { console.log('no key 2'); return }
  const apiKey = key.apiKey, secret = decrypt(key.secretEnc)
  const ts = Date.now()
  const st = Date.now() - 180 * 24 * 60 * 60 * 1000  // 180 days
  
  // Test 1: BTCUSDT with startTime
  const qs = 'symbol=BTCUSDT&limit=5&startTime=' + st + '&recvWindow=60000&timestamp=' + ts
  const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex')
  const res = await fetch('https://fapi.binance.com/fapi/v1/userTrades?' + qs + '&signature=' + sig, 
    {headers: {'X-MBX-APIKEY': apiKey}})
  const text = await res.text()
  console.log('Test BTCUSDT (180d): status', res.status)
  try { const j = JSON.parse(text); console.log('count:', Array.isArray(j) ? j.length : 'NOT_ARRAY', Array.isArray(j) && j.length > 0 ? JSON.stringify(j[0]).slice(0, 300) : text.slice(0, 200)) }
  catch { console.log('body:', text.slice(0, 300)) }
  
  // Test 2: without startTime (recent 7 days only)
  const qs2 = 'symbol=BTCUSDT&limit=5&recvWindow=60000&timestamp=' + Date.now()
  const sig2 = crypto.createHmac('sha256', secret).update(qs2).digest('hex')
  const res2 = await fetch('https://fapi.binance.com/fapi/v1/userTrades?' + qs2 + '&signature=' + sig2,
    {headers: {'X-MBX-APIKEY': apiKey}})
  const text2 = await res2.text()
  console.log('\nTest BTCUSDT (7d): status', res2.status)
  try { const j = JSON.parse(text2); console.log('count:', Array.isArray(j) ? j.length : text2.slice(0, 200)) }
  catch { console.log('body:', text2.slice(0, 300)) }
  
  process.exit(0)
}
main()
