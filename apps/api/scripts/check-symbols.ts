import {db} from '../src/db/index.js'
import {trades} from '../src/db/schema.js'
import {eq, sql} from 'drizzle-orm'

async function main() {
  const r = await db
    .select({symbol: trades.symbol, count: sql<number>`count(*)::int`})
    .from(trades).where(eq(trades.apiKeyId, 2))
    .groupBy(trades.symbol)
    .orderBy(sql`count(*) desc`)
  console.log('Key 2 币种数:', r.length)
  console.log('明细:', JSON.stringify(r, null, 2))
  process.exit(0)
}
main()
