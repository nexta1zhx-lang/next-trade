import {Hono} from 'hono'
import {z} from 'zod'
import {zValidator} from '@hono/zod-validator'
import {
  getConfig,
  updateConfig,
  resetConfig
} from '../services/configService.js'

const router = new Hono()

const configSchema = z.object({
  minQuoteVolume: z.number().positive().optional(),
  topCandidates: z.number().int().positive().optional(),
  topFinal: z.number().int().positive().optional(),
  atrPeriod: z.number().int().positive().optional(),
  bbPeriod: z.number().int().positive().optional(),
  bbStdDev: z.number().positive().optional(),
  kcPeriod: z.number().int().positive().optional(),
  kcAtrMultiplier: z.number().positive().optional(),
  volumeSpikeThreshold: z.number().positive().optional(),
  volumeShrinkThreshold: z.number().positive().max(1).optional(),
  priceProximityPct: z.number().positive().optional(),
  cooldownMs: z.number().int().positive().optional()
})

/**
 * GET /api/market/config
 */
router.get('/', async c => {
  const config = await getConfig()
  return c.json({success: true, data: config})
})

/**
 * PUT /api/market/config
 */
router.put('/', zValidator('json', configSchema), async c => {
  const partial = c.req.valid('json')
  const updated = await updateConfig(partial)
  return c.json({success: true, data: updated})
})

/**
 * POST /api/market/config/reset
 */
router.post('/reset', async c => {
  const config = await resetConfig()
  return c.json({success: true, data: config})
})

export {router as configRouter}
