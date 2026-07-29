/**
 * 服务器监控服务
 * 定时从 Node Exporter 抓取系统指标，存入 PostgreSQL 提供历史查询
 */

import {db} from '../db/index.js'
import {serverMetrics} from '../db/schema.js'
import {desc, between, sql} from 'drizzle-orm'

const NODE_EXPORTER_URL = 'http://node-exporter:9100/metrics'

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
      const m = text.match(new RegExp(`^${prefix}\\s+([\\d.eE+-]+)`, 'm'))
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

    // CPU 使用率（用 load1 / 核心数 估算）
    const load1 = get('node_load1')
    // 从 node_cpu 指标算核心数
    const cpuMatches = text.match(/^node_cpu_seconds_total{cpu="(\d+)"/gm)
    const cpuCount = cpuMatches ? new Set(cpuMatches.map(m => m.match(/"(\d+)"/)?.[1])).size : 1
    const cpuPercent = cpuCount > 0 ? Math.min(100, Math.round((load1 / cpuCount) * 10000) / 100) : 0

    // 磁盘（根分区使用率）
    let diskPercent = 0
    const lines = text.split('\n')
    let diskSize = 0, diskAvail = 0
    for (const line of lines) {
      if (line.startsWith('node_filesystem_size_bytes') && line.includes('mountpoint="/"') && !line.includes('device="tmpfs"')) {
        const m = line.match(/[\d.eE+-]+$/)
        if (m) diskSize = parseFloat(m[0])
      }
      if (line.startsWith('node_filesystem_avail_bytes') && line.includes('mountpoint="/"') && !line.includes('device="tmpfs"')) {
        const m = line.match(/[\d.eE+-]+$/)
        if (m) diskAvail = parseFloat(m[0])
      }
    }
    if (diskSize > 0) {
      diskPercent = Math.round(((diskSize - diskAvail) / diskSize) * 10000) / 100
    }

    // 网络（取所有接口总和，排除 lo）
    let netRx = 0, netTx = 0
    for (const line of lines) {
      if (line.startsWith('node_network_receive_bytes_total') && !line.includes('device="lo"')) {
        const m = line.match(/[\d.eE+-]+$/)
        if (m) netRx += parseFloat(m[0])
      }
      if (line.startsWith('node_network_transmit_bytes_total') && !line.includes('device="lo"')) {
        const m = line.match(/[\d.eE+-]+$/)
        if (m) netTx += parseFloat(m[0])
      }
    }

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memPercent: Math.round(memPercent * 100) / 100,
      memUsedMb: Math.round(memUsed / 1024 / 1024 * 10) / 10,
      memTotalMb: Math.round(memTotal / 1024 / 1024 * 10) / 10,
      swapPercent: Math.round(swapPercent * 100) / 100,
      diskPercent: Math.round(diskPercent * 100) / 100,
      diskTotalGb: Math.round(diskSize / 1024 / 1024 / 1024 * 10) / 10,
      diskUsedGb: Math.round((diskSize - diskAvail) / 1024 / 1024 / 1024 * 10) / 10,
      netRxBytes: diskAvail, // 复用字段存磁盘剩余字节
      netTxBytes: diskSize   // 复用字段存磁盘总字节
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

/** Docker 容器信息 */
export interface ContainerInfo {
  name: string
  memUsage: number
  memLimit: number
  memPercent: number
  cpuPercent: number
  pids: number
}

/** 获取 Docker 容器统计（通过 Docker socket） */
export async function getDockerStats(): Promise<ContainerInfo[]> {
  try {
    // 列出所有容器
    const listRes = await fetch('http://localhost/v1.47/containers/json', {
      headers: {Host: ''},
      signal: AbortSignal.timeout(5000)
    })
    if (!listRes.ok) return []
    const containers = await listRes.json() as any[]

    // 并发获取每个容器的 stats
    const stats = await Promise.all(
      containers.map(async (c: any) => {
        try {
          const sRes = await fetch(
            `http://localhost/v1.47/containers/${c.Id}/stats?stream=false`,
            {headers: {Host: ''}, signal: AbortSignal.timeout(3000)}
          )
          if (!sRes.ok) return null
          const s = await sRes.json() as any
          const name = (c.Names?.[0] ?? '').replace(/^\//, '')
          const memUsage = (s.memory_stats?.usage ?? 0) - (s.memory_stats?.stats?.cache ?? 0)
          const memLimit = s.memory_stats?.limit ?? 1
          const cpuDelta = s.cpu_stats?.cpu_usage?.total_usage ?? 0
          const sysDelta = s.cpu_stats?.system_cpu_usage ?? 1
          const preCpu = s.precpu_stats?.cpu_usage?.total_usage ?? 0
          const preSys = s.precpu_stats?.system_cpu_usage ?? 1
          const cpuPerc = sysDelta > preSys
            ? ((cpuDelta - preCpu) / (sysDelta - preSys)) * (s.cpu_stats?.online_cpus ?? 1) * 100
            : 0
          return {
            name,
            memUsage: memUsage / 1024 / 1024,
            memLimit: memLimit / 1024 / 1024,
            memPercent: (memUsage / memLimit) * 100,
            cpuPercent: Math.min(100, Math.round(cpuPerc * 100) / 100),
            pids: s.pids_stats?.current ?? 0
          }
        } catch { return null }
      })
    )

    return stats.filter(Boolean) as ContainerInfo[]
  } catch {
    return []
  }
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
  diskUsedGb: number
  diskTotalGb: number
}>> {
  const since = new Date(Date.now() - hours * 3600 * 1000)

  const rows = await db
    .select()
    .from(serverMetrics)
    .where(between(serverMetrics.collectedAt, since, new Date()))
    .orderBy(desc(serverMetrics.collectedAt))
    .limit(1000)

  return rows.reverse().map(r => {
    const diskTotal = parseFloat(r.netTxBytes) // 存的是 diskSize
    const diskAvail = parseFloat(r.netRxBytes) // 存的是 diskAvail
    const diskUsed = diskTotal - diskAvail
    return {
      collectedAt: r.collectedAt?.toISOString() ?? '',
      cpuPercent: parseFloat(r.cpuPercent),
      memPercent: parseFloat(r.memPercent),
      memUsedMb: parseFloat(r.memUsedMb),
      memTotalMb: parseFloat(r.memTotalMb),
      swapPercent: parseFloat(r.swapPercent),
      diskPercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 10000) / 100 : 0,
      diskUsedGb: Math.round(diskUsed / 1024 / 1024 / 1024 * 10) / 10,
      diskTotalGb: Math.round(diskTotal / 1024 / 1024 / 1024 * 10) / 10
    }
  })
}
