/**
 * 清空 trades 表并重新同步最近 30 天
 *
 * 用法: npx tsx scripts/truncate-and-sync.ts [keyId]
 * 不指定 keyId 则同步所有活跃 Key
 */

import {db} from '../src/db/index.js'
import {trades, apiKeys} from '../src/db/schema.js'
import {positions} from '../src/db/schema.js'
import {eq, and, sql} from 'drizzle-orm'
import {
  syncAllSymbols,
  incrementalSync
} from '../src/services/tradeSyncService.js'

async function main() {
  const targetKeyId = process.argv[2] ? Number(process.argv[2]) : undefined

  // 查询目标 Key
  const conditions = [eq(apiKeys.exchangeId, 'binance')]
  if (targetKeyId) conditions.push(eq(apiKeys.id, targetKeyId))

  const keys = await db
    .select({
      id: apiKeys.id,
      exchangeId: apiKeys.exchangeId,
      label: apiKeys.accountLabel
    })
    .from(apiKeys)
    .where(and(...conditions))

  if (keys.length === 0) {
    console.log('没有找到 Binance Key')
    process.exit(0)
  }

  console.log('找到以下 Key:')
  for (const k of keys) {
    console.log(`  ID ${k.id}: ${k.exchangeId} / "${k.label}"`)
  }

  // 清空 trades + positions 表
  console.log('\n清空 trades 表...')
  await db.delete(trades)
  console.log('清空 positions 表...')
  await db.delete(positions)

  // 逐 Key 同步
  for (const key of keys) {
    console.log(`\n=== 同步 Key ${key.id} (${key.label}) 最近 30 天 ===`)
    const result = await syncAllSymbols(
      key.id,
      Date.now() - 30 * 24 * 60 * 60 * 1000,
      true
    )
    console.log(
      `完成: ${result.totalInserted} 条成交, ${result.symbolCount} 币种`
    )
  }

  console.log('\n✅ 全部完成')
  process.exit(0)
}

main().catch(err => {
  console.error('❌', err)
  process.exit(1)
})
