/**
 * 服务器监控服务
 * 定时从 Node Exporter 抓取系统指标，存入 PostgreSQL 提供历史查询
 */

import {db} from '../db/index.js'
import {serverMetrics} from '../db/schema.js'
import {desc, between, sql} from 'drizzle-orm'

const NODE_EXPORTER_URL = 'http://localhost:9100/metrics'

/** 从 Node Exporter 抓取并解析关键指标 */
export async function fetchNodeMetrics(): Promise<{
  cpuPercent: number
  memPercent: number
  memUsedMb: number
  memTotalMb: number
  swapPercent: number
  diskPercent: number
  netRxBytes: number
  netTxBytes: number
} | null> {
  try {
    const res = await fetch(NODE_EXPORTER_URL, {signal: AbortSignal.timeout(5000)})
    if (!res.ok) return null
    const text = await res.text()

    const get = (prefix: string): number => {
      const m = text.match(new RegExp(`^${prefix}\\s+([\\d.]+)`, 'm'))
      return m ? parseFloat(m[1]) : 0
    }

    // 内存
    const memTotal = get('node_memory_MemTotal_bytes')
    const memFree = get('node_memory_MemFree_bytes')
    const memBuffers = get('node_memory_Buffers_bytes')
    const memCached = get('node_memory_Cached_bytes')
    const memUsed = memTotal - memFree - memBuffers - memCached
    const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

    // Swap
    const swapTotal = get('node_memory_SwapTotal_bytes')
    const swapFree = get('node_memory_SwapFree_bytes')
    const swapPercent = swapTotal > 0 ? ((swapTotal - swapFree) / swapTotal) * 100 : 0

    // CPU (idle 占比)
    const cpuIdle = get('node_cpu_seconds_total{mode="idle"}')
    // 用 node_load1 近似 CPU 使用率
    const load1 = get('node_load1')
    const cpuCount = get('node_nprocs')
    const cpuPercent = cpuCount > 0 ? Math.min(100, (load1 / cpuCount) * 100) : 0

    // 磁盘
    let diskPercent = 0
    const diskMatch = text.match(/node_filesystem_avail_bytes{device="[^"]+",fstype="[^"]+",mountpoint="/"[^}]*}\s+([\d.]+)/)
    const diskTotalMatch = text.match(/node_filesystem_size_bytes{device="[^"]+",fstype="[^"]+",mountpoint="/"[^}]*}\s+([\d.]+)/)
    if (diskTotalMatch && diskMatch) {
      const total = parseFloat(diskTotalMatch[1])
      const avail = parseFloat(diskMatch[1])
      diskPercent = total > 0 ? ((total - avail) / total) * 100 : 0
    }

    // 网络（取所有接口总和）
    const netRx = get('node_network_receive_bytes_total')
    const netTx = get('node_network_transmit_bytes_total')

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memPercent: Math.round(memPercent * 100) / 100,
      memUsedMb: Math.round(memUsed / 1024 / 1024 * 10) / 10,
      memTotalMb: Math.round(memTotal / 1024 / 1024 * 10) / 10,
      swapPercent: Math.round(swapPercent * 100) / 100,
      diskPercent: Math.round(diskPercent * 100) / 100,
      netRxBytes: Math.round(netRx),
      netTxBytes: Math.round(netTx)
    }
  } catch {
    return null
  }
}

/** 采集一次并存入数据库 */
export async function collectMetrics(): Promise<void> {
  const metrics = await fetchNodeMetrics()
  if (!metrics) return

  await db.insert(serverMetrics).values({
    cpuPercent: String(metrics.cpuPercent),
    memPercent: String(metrics.memPercent),
    memUsedMb: String(metrics.memUsedMb),
    memTotalMb: String(metrics.memTotalMb),
    swapPercent: String(metrics.swapPercent),
    diskPercent: String(metrics.diskPercent),
    netRxBytes: String(metrics.netRxBytes),
    netTxBytes: String(metrics.netTxBytes)
  })
}

/** 查询历史指标 */
export async function queryMetrics(
  hours = 24
): Promise<Array<{
  collectedAt: string
  cpuPercent: number
  memPercent: number
  memUsedMb: number
  memTotalMb: number
  swapPercent: number
  diskPercent: number
}>> {
  const since = new Date(Date.now() - hours * 3600 * 1000)

  const rows = await db
    .select()
    .from(serverMetrics)
    .where(between(serverMetrics.collectedAt, since, new Date()))
    .orderBy(desc(serverMetrics.collectedAt))
    .limit(1000)

  return rows.reverse().map(r => ({
    collectedAt: r.collectedAt?.toISOString() ?? '',
    cpuPercent: parseFloat(r.cpuPercent),
    memPercent: parseFloat(r.memPercent),
    memUsedMb: parseFloat(r.memUsedMb),
    memTotalMb: parseFloat(r.memTotalMb),
    swapPercent: parseFloat(r.swapPercent),
    diskPercent: parseFloat(r.diskPercent)
  }))
}
