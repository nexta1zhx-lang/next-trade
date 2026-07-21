/**
 * 多交易所 API Key 校验器
 *
 * 使用 CCXT 对各交易所进行:
 *   1. 连接测试 — Key/Secret 是否有效
 *   2. 只读权限检测 — 检测到 Trade/Withdraw 权限则拒绝绑定
 *   3. 标签化结果 — 返回可读的错误信息
 *
 * 支持交易所: Binance, OKX, Bybit, Bitget, Gate.io, MEXC
 */

import ccxt, {Exchange} from 'ccxt'
import {config} from '../../config.js'

// ─── 代理配置 ───
const proxyOptions = config.HTTPS_PROXY ? {httpsProxy: config.HTTPS_PROXY} : {}

// ─── 交易所显示名映射 ───
export const EXCHANGE_DISPLAY: Record<string, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  bitget: 'Bitget',
  gate: 'Gate.io',
  mexc: 'MEXC'
}

// ─── 支持的交易所列表 ───
export const SUPPORTED_EXCHANGES = Object.keys(EXCHANGE_DISPLAY)

// ─── 校验结果 ───
export interface ValidationResult {
  valid: boolean
  /** 是否为只读 Key */
  isReadOnly: boolean
  /** 账户信息（校验通过后返回） */
  accountInfo?: {
    /** 账户类型描述 */
    type: string
    /** 账户能否交易 */
    canTrade: boolean
    /** 账户能否提现 */
    canWithdraw: boolean
  }
  error?: string
}

// ─── CCXT 交易所工厂 ───
function createExchange(
  exchangeId: string,
  credentials: {apiKey: string; apiSecret: string; passphrase?: string}
): Exchange {
  const opts: Record<string, any> = {
    apiKey: credentials.apiKey,
    secret: credentials.apiSecret,
    ...proxyOptions
  }
  if (credentials.passphrase) opts.password = credentials.passphrase

  switch (exchangeId) {
    case 'binance':
      return new ccxt.binance({...opts, options: {defaultType: 'swap'}})
    case 'okx':
      return new ccxt.okx(opts)
    case 'bybit':
      return new ccxt.bybit(opts)
    case 'bitget':
      return new ccxt.bitget(opts)
    case 'gate':
      return new ccxt.gate(opts)
    case 'mexc':
      return new ccxt.mexc(opts)
    default:
      throw new Error(`Unsupported exchange: ${exchangeId}`)
  }
}

/**
 * 校验交易所 API Key
 *
 * 步骤:
 *   1. 创建 CCXT 实例
 *   2. 调用 fetchBalance() 验证连接
 *   3. 对支持的交易所尝试检测权限（只读检测）
 *   4. 返回校验结果
 */
export async function validateExchangeKey(
  exchangeId: string,
  credentials: {apiKey: string; apiSecret: string; passphrase?: string}
): Promise<ValidationResult> {
  try {
    const ex = createExchange(exchangeId, credentials)

    // 1. 连接测试: 获取余额
    // 注意: Binance swap 模式下 fetchBalance 会调用 sapi/v1/capital/config/getall
    // 只读 Key 没有该权限时会报错，此时降级为"有效"（Key 本身可用）
    try {
      await ex.fetchBalance()
    } catch (balanceErr: any) {
      const bMsg = balanceErr.message ?? ''
      // SAPI 权限不足不视为错误（只读 Key 正常现象）
      if (
        bMsg.includes('capital/config') ||
        bMsg.includes('enableWithdrawals')
      ) {
        // Key 有效，只是无法访问 SAPI → 仍然标记为有效
      } else {
        // 其他余额获取错误 → 抛出让外层 catch 处理
        throw balanceErr
      }
    }

    // 2. 权限检测
    const permissionCheck = await checkPermissions(ex, exchangeId)

    return {
      valid: true,
      isReadOnly: permissionCheck.isReadOnly,
      accountInfo: {
        type: exchangeId,
        canTrade: !permissionCheck.isReadOnly,
        canWithdraw: permissionCheck.canWithdraw ?? false
      }
    }
  } catch (err: any) {
    const msg = err.message ?? String(err)
    let userMsg: string

    if (
      msg.includes('API-key format invalid') ||
      msg.includes('Invalid API-key')
    ) {
      userMsg = 'API Key 格式无效'
    } else if (msg.includes('Signature')) {
      userMsg = 'Secret Key 不匹配'
    } else if (msg.includes('permission')) {
      userMsg = 'API Key 权限不足'
    } else if (msg.includes('IP')) {
      userMsg = 'IP 不在白名单内'
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      userMsg = '连接超时，请检查网络或代理配置'
    } else {
      userMsg = msg.slice(0, 120)
    }

    return {valid: false, isReadOnly: false, error: userMsg}
  }
}

/**
 * 交易所特定权限检测
 */
async function checkPermissions(
  ex: Exchange,
  exchangeId: string
): Promise<{isReadOnly: boolean; canWithdraw?: boolean}> {
  try {
    switch (exchangeId) {
      case 'binance': {
        const accountInfo: any = await (ex as any).fetchAccountInfo?.()
        if (accountInfo) {
          const canTrade =
            accountInfo.canTrade ?? accountInfo.enableTrading ?? true
          const canWithdraw =
            accountInfo.canWithdraw ?? accountInfo.enableWithdrawals ?? false
          return {isReadOnly: !canTrade, canWithdraw}
        }
        break
      }
      case 'okx': {
        try {
          const cfg: any = await (ex as any).privateGetAccountConfig?.()
          const acct = cfg?.data?.[0]
          if (acct)
            return {isReadOnly: acct.canTrade === false, canWithdraw: false}
        } catch {}
        break
      }
      case 'bybit': {
        try {
          const keyInfo: any = await (ex as any).privateGetV5ApiKey?.()
          const perms = keyInfo?.result?.permissions
          if (perms) {
            const canTrade = perms.spot?.trade || perms.contract?.trade
            return {isReadOnly: !canTrade, canWithdraw: !!perms.withdraw}
          }
        } catch {}
        break
      }
    }
  } catch {}

  return {isReadOnly: false, canWithdraw: false}
}

/**
 * 获取交易所显示名称
 */
export function getExchangeDisplayName(exchangeId: string): string {
  return EXCHANGE_DISPLAY[exchangeId] ?? exchangeId
}
