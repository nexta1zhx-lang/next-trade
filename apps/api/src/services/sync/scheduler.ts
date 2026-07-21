/**
 * 定时同步调度器
 *
 * - 每 5 分钟执行余额快照（takeAllSnapshots）
 * - 分布式锁（避免多节点重复同步）
 */

import {takeAllSnapshots} from './snapshotService.js'

let snapshotInterval: ReturnType<typeof setInterval> | null = null

/**
 * 启动定时快照（每 5 分钟）
 */
export function startSnapshotScheduler(intervalMs = 5 * 60 * 1000): void {
  if (snapshotInterval) return

  console.log('[Scheduler] Starting snapshot scheduler...')

  // 启动后立即执行一次
  runSnapshotTask()

  // 定时执行
  snapshotInterval = setInterval(runSnapshotTask, intervalMs)
}

/**
 * 停止调度器
 */
export function stopSnapshotScheduler(): void {
  if (snapshotInterval) {
    clearInterval(snapshotInterval)
    snapshotInterval = null
  }
}

async function runSnapshotTask(): Promise<void> {
  try {
    const results = await takeAllSnapshots()
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    if (results.length > 0) {
      console.log(
        `[Scheduler] Snapshots done: ${successCount} ok${failCount > 0 ? `, ${failCount} failed` : ''}`
      )
    }
  } catch (err) {
    console.error('[Scheduler] Snapshot task error:', (err as Error).message)
  }
}
