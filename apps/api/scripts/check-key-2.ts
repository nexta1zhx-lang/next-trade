import {db} from '../src/db/index.js'
import {trades, positions} from '../src/db/schema.js'
import {eq, sql} from 'drizzle-orm'

async function main() {
  const t2 = await db.select({c: sql<number>`count(*)::int`}).from(trades).where(eq(trades.apiKeyId, 2))
  const p2 = await db.select({c: sql<number>`count(*)::int`}).from(positions).where(eq(positions.apiKeyId, 2))
  console.log('Key 2 trades:', t2[0]?.c, 'positions:', p2[0]?.c)
  if (t2[0]?.c > 0) {
    const s = await db.select({side: trades.side, symbol: trades.symbol, price: trades.price, amount: trades.amount, realizedPnl: trades.realizedPnl, executedAt: trades.executedAt})
      .from(trades).where(eq(trades.apiKeyId, 2)).limit(10)
    console.log('samples:', JSON.stringify(s, null, 2))
  }
  process.exit(0)
}
main()
