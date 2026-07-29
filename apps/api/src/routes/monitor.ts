/**
 * 服务器监控路由
 *
 * GET  /api/monitor/now     — 实时指标
 * GET  /api/monitor/history — 历史指标 (?hours=24)
 */

import {Hono} from 'hono'
import {fetchNodeMetrics, queryMetrics} from '../services/monitorService.js'

const router = new Hono()

// ═══════════════════════════════════════════
// GET /api/monitor/now — 实时指标（无需登录）
// ═══════════════════════════════════════════

router.get('/now', async c => {
  const metrics = await fetchNodeMetrics()
  if (!metrics) {
    return c.json({success: false, error: '无法获取监控数据'}, 503)
  }
  return c.json({success: true, data: metrics})
})

// ═══════════════════════════════════════════
// GET /api/monitor/history — 历史指标
// ═══════════════════════════════════════════

router.get('/history', async c => {
  const hours = Math.min(168, Math.max(1, parseInt(c.req.query('hours') ?? '24')))
  const data = await queryMetrics(hours)
  return c.json({success: true, data})
})

export {router as monitorRouter}
