/**
 * V1 资金曲线路由
 *
 * GET /api/v1/analytics/equity-curve
 *   - 查询资金曲线（净值走势 / 累计收益率 / 回撤）
 *   - 支持多账户合并 / 基准对比
 *   - 数据从 trades 表实时聚合
 */

import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {computeEquityCurve} from '../../../services/analytics/equityService.js'

const router = new Hono()

router.use('*', async (c, next) => {
  const userId = (c as any).get('userId') as number | undefined
  if (!userId) return c.json({success: false, error: 'Unauthorized'}, 401)
  await next()
})

const querySchema = z.object({
  keyId: z.coerce.number().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})

router.get('/', zValidator('query', querySchema), async c => {
  const userId = (c as any).get('userId') as number
  const params = c.req.valid('query')

  const data = await computeEquityCurve({
    userId,
    keyId: params.keyId,
    startDate: params.startDate,
    endDate: params.endDate
  })

  return c.json({success: true, data})
})

export {router as equityRouter}
