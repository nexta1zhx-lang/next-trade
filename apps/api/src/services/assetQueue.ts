/**
 * BullMQ 资产快照采集队列
 *
 * 每小时投递一次全量采集任务（每小时整点），
 * 支持手动触发单 Key 采集。
 */

import {Queue, Worker, Job} from 'bullmq'
import IORedis from 'ioredis'
import {collectAssetSnapshot} from './assetService.js'
import {db} from '../db/index.js'
import {apiKeys} from '../db/schema.js'
import {eq, and} from 'drizzle-orm'
import {config} from '../config.js'

// ─── BullMQ 专用 Redis 连接（必须设置 maxRetriesPerRequest=null） ───
const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true
})

export const assetQueue = new Queue('asset-snapshot', {
  connection,
  defaultJobOptions: {
    removeOnComplete: {age: 3600}, // 保留 1h
    removeOnFail: {age: 86400}, // 失败保留 1d
    attempts: 3, // 最多重试 3 次
    backoff: {type: 'exponential', delay: 10000} // 指数退避
  }
})

// ─── Worker ───

const worker = new Worker(
  'asset-snapshot',
  async (job: Job) => {
    // batch 任务：查所有 ACTIVE Key 逐个投递
    if (job.name === 'batch-snapshot') {
      console.log(`[AssetQueue] batch 任务触发，开始投递全量采集`)
      const count = await enqueueAllSnapshots()
      console.log(`[AssetQueue] batch 完成，投递 ${count} 个任务`)
      return
    }

    // 单 Key 采集
    const {apiKeyId} = job.data as {apiKeyId: number}
    if (!apiKeyId) {
      console.warn(`[AssetQueue] 跳过无效任务: ${job.name}`)
      return
    }
    console.log(`[AssetQueue] 开始采集 key=${apiKeyId} (job=${job.id})`)
    await collectAssetSnapshot(apiKeyId)
  },
  {
    connection,
    concurrency: 3, // 最多 3 个并行采集
    limiter: {
      max: 10, // 每秒最多 10 个
      duration: 1000
    }
  }
)

worker.on('completed', job => {
  if (job.name === 'batch-snapshot') return
  console.log(`[AssetQueue] ✅ key=${job.data.apiKeyId} 完成 (job=${job.id})`)
})

worker.on('failed', (job, err) => {
  if (job?.name === 'batch-snapshot') {
    console.error(`[AssetQueue] ❌ batch 失败:`, err.message)
    return
  }
  console.error(`[AssetQueue] ❌ key=${job?.data.apiKeyId} 失败:`, err.message)
})

worker.on('error', err => {
  console.error('[AssetQueue] Worker error:', err.message)
})

// ─── 投递任务 ───

/**
 * 投递单个 Key 的采集任务
 */
export async function enqueueAssetSnapshot(apiKeyId: number): Promise<void> {
  await assetQueue.add(
    `snapshot:${apiKeyId}`,
    {apiKeyId},
    {
      jobId: `snapshot-${apiKeyId}-${Date.now()}`
    }
  )
}

/**
 * 投递所有 ACTIVE Key 的全量采集任务
 */
export async function enqueueAllSnapshots(): Promise<number> {
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(and(eq(apiKeys.exchangeId, 'binance'), eq(apiKeys.status, 'ACTIVE')))

  for (const key of keys) {
    await enqueueAssetSnapshot(key.id)
  }

  console.log(`[AssetQueue] 投递 ${keys.length} 个采集任务`)
  return keys.length
}

/**
 * 投递某用户的所有 Key 采集任务
 */
export async function enqueueUserSnapshots(userId: number): Promise<number> {
  const keys = await db
    .select({id: apiKeys.id})
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.exchangeId, 'binance'),
        eq(apiKeys.status, 'ACTIVE')
      )
    )

  for (const key of keys) {
    await enqueueAssetSnapshot(key.id)
  }

  return keys.length
}
