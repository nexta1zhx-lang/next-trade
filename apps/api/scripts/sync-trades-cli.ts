/**
 * 手动触发成交同步 CLI
 * 用法: npx tsx scripts/sync-trades-cli.ts [keyId] [startDate] [forceFullScan]
 * forceFullScan: true=扫全部529币种, false(默认)=只扫已有记录的币种
 * 示例: npx tsx scripts/sync-trades-cli.ts 2 2026-07-01 true
 */
import 'dotenv/config'
import {syncAllSymbols} from '../src/services/tradeSyncService.js'

async function main() {
  const keyId = parseInt(process.argv[2] || '3')
  const startDate = process.argv[3]
  const forceFullScan = process.argv[4] === 'true'

  let startTime: number | undefined
  if (startDate) {
    startTime = new Date(startDate + 'T00:00:00Z').getTime()
  }

  console.log(
    `同步 Key ${keyId}, 起始: ${startDate || '30天前'}, 全量扫描: ${forceFullScan}`
  )
  console.time('同步耗时')
  const result = await syncAllSymbols(keyId, startTime, forceFullScan)
  console.timeEnd('同步耗时')
  console.log(
    `结果: ${result.totalInserted} 条成交, ${result.symbolCount} 个币种`
  )
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
