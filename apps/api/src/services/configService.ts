import {redis} from './redis.js'

// ─── 配置 Key ───
const CONFIG_KEY = 'market:config:indicators'

// ─── 配置默认值 ───
export interface IndicatorConfig {
  // PA 过滤
  minQuoteVolume: number
  topCandidates: number
  topFinal: number

  // 技术指标
  atrPeriod: number
  bbPeriod: number
  bbStdDev: number
  kcPeriod: number
  kcAtrMultiplier: number

  // 碰撞引擎
  volumeSpikeThreshold: number
  volumeShrinkThreshold: number
  priceProximityPct: number
  cooldownMs: number

  // Squeeze
  squeezeBbPeriod: number
  squeezeKcPeriod: number
  squeezeKcMultiplier: number
}

export const DEFAULT_CONFIG: IndicatorConfig = {
  minQuoteVolume: 20_000_000,
  topCandidates: 30,
  topFinal: 10,

  atrPeriod: 14,
  bbPeriod: 20,
  bbStdDev: 2,
  kcPeriod: 20,
  kcAtrMultiplier: 1.5,

  volumeSpikeThreshold: 2.5,
  volumeShrinkThreshold: 0.7,
  priceProximityPct: 0.003,
  cooldownMs: 3 * 60 * 1000,

  squeezeBbPeriod: 20,
  squeezeKcPeriod: 20,
  squeezeKcMultiplier: 1.5
}

/**
 * 读取当前配置（Redis → 默认 fallback）
 */
export async function getConfig(): Promise<IndicatorConfig> {
  if (redis.status !== 'ready') return {...DEFAULT_CONFIG}

  try {
    const raw = await redis.get(CONFIG_KEY)
    if (!raw) return {...DEFAULT_CONFIG}
    return {...DEFAULT_CONFIG, ...JSON.parse(raw)}
  } catch {
    return {...DEFAULT_CONFIG}
  }
}

/**
 * 更新配置（合并写入 Redis）
 */
export async function updateConfig(
  partial: Partial<IndicatorConfig>
): Promise<IndicatorConfig> {
  const current = await getConfig()
  const merged = {...current, ...partial}

  if (redis.status === 'ready') {
    await redis.set(CONFIG_KEY, JSON.stringify(merged))
  }

  return merged
}

/**
 * 重置为默认配置
 */
export async function resetConfig(): Promise<IndicatorConfig> {
  if (redis.status === 'ready') {
    await redis.del(CONFIG_KEY)
  }
  return {...DEFAULT_CONFIG}
}
