'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  createElement,
  type ReactNode
} from 'react'

export type DeviceType = 'mobile' | 'tablet' | 'desktop'

export interface DeviceInfo {
  /** 最终判断的设备类型 */
  deviceType: DeviceType
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  /** 是否支持触控 */
  hasTouch: boolean
  /** 指针精度是否为 coarse（触控屏典型特征） */
  hasCoarsePointer: boolean
  /** 当前视口宽度 */
  width: number
  /** 设备品牌，如 'Apple', 'Samsung' 等（仅 UA 可识别时） */
  brand?: string
  /** 设备型号，如 'iPad', 'iPhone' 等（仅 UA 可识别时） */
  model?: string
}

const DEFAULT_INFO: DeviceInfo = {
  deviceType: 'desktop',
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  hasTouch: false,
  hasCoarsePointer: false,
  width: 1200
}

const DeviceTypeContext = createContext<DeviceInfo>(DEFAULT_INFO)

// ─── UA 解析 ───

function parseUA(ua: string): {
  brand?: string
  model?: string
  isMobile: boolean
  isTablet: boolean
} {
  const lower = ua.toLowerCase()

  const isTablet =
    /ipad/i.test(lower) ||
    (/macintosh/i.test(lower) && 'ontouchend' in document) ||
    (/android/i.test(lower) && !/mobile/i.test(lower)) ||
    /tablet/i.test(lower) ||
    /playbook/i.test(lower) ||
    /silk/i.test(lower) ||
    /kindle/i.test(lower)

  const isMobile =
    !isTablet &&
    (/iphone/i.test(lower) ||
      /ipod/i.test(lower) ||
      /android.*mobile/i.test(lower) ||
      /blackberry/i.test(lower) ||
      /windows phone/i.test(lower) ||
      /opera mini/i.test(lower) ||
      /mobile/i.test(lower))

  let brand: string | undefined
  let model: string | undefined

  if (/ipad/i.test(lower)) {
    brand = 'Apple'
    model = 'iPad'
  } else if (/iphone/i.test(lower)) {
    brand = 'Apple'
    model = 'iPhone'
  } else if (/macintosh/i.test(lower)) {
    brand = 'Apple'
    model = 'Mac'
  } else if (/android/i.test(lower)) {
    brand = 'Android'
    const match = ua.match(/\(([^;]+)/)
    if (match) model = match[1].trim()
  } else if (/samsung/i.test(lower)) {
    brand = 'Samsung'
  } else if (/huawei/i.test(lower)) {
    brand = 'Huawei'
  } else if (/xiaomi/i.test(lower)) {
    brand = 'Xiaomi'
  }

  return {brand, model, isMobile, isTablet}
}

function getDeviceTypeFromWidth(width: number): DeviceType {
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

/** 纯函数：根据 UA + 运行时能力计算 DeviceInfo（可在 Worker 中复用） */
export function computeDeviceInfo(): DeviceInfo {
  const width = window.innerWidth
  const ua = navigator.userAgent
  const {brand, model, isMobile: uaMobile, isTablet: uaTablet} = parseUA(ua)
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches
  const hasHover = window.matchMedia('(hover: hover)').matches

  let deviceType: DeviceType

  if (uaMobile) {
    deviceType = 'mobile'
  } else if (uaTablet) {
    deviceType = 'tablet'
  } else if (hasCoarsePointer && !hasFinePointer) {
    deviceType = width < 768 ? 'mobile' : 'tablet'
  } else if (!hasHover && hasTouch) {
    deviceType = width < 768 ? 'mobile' : 'tablet'
  } else {
    deviceType = getDeviceTypeFromWidth(width)
  }

  return {
    deviceType,
    isMobile: deviceType === 'mobile',
    isTablet: deviceType === 'tablet',
    isDesktop: deviceType === 'desktop',
    hasTouch,
    hasCoarsePointer,
    width,
    brand,
    model
  }
}

// ─── Provider ───

/**
 * 全局设备类型 Provider。
 * 放在应用根层，所有子组件通过 useDeviceType() 共享同一份设备信息，
 * 避免每个组件独立创建 useState + resize 监听。
 */
export function DeviceTypeProvider({children}: {children: ReactNode}) {
  // 初始化固定 DEFAULT_INFO，SSR 和客户端首次渲染一致，避免 hydration 不匹配。
  // 真实设备信息在 useEffect 中获取，hydrate 完成后立即更新。
  const [info, setInfo] = useState<DeviceInfo>(DEFAULT_INFO)

  useEffect(() => {
    // hydrate 完成后立即更新为真实设备信息
    setInfo(computeDeviceInfo())

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const update = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        setInfo(computeDeviceInfo())
      }, 100)
    }

    window.addEventListener('resize', update)
    const coarseMql = window.matchMedia('(pointer: coarse)')
    const hoverMql = window.matchMedia('(hover: hover)')
    coarseMql.addEventListener('change', update)
    hoverMql.addEventListener('change', update)

    return () => {
      window.removeEventListener('resize', update)
      coarseMql.removeEventListener('change', update)
      hoverMql.removeEventListener('change', update)
      clearTimeout(timeoutId)
    }
  }, [])

  return createElement(DeviceTypeContext.Provider, {value: info}, children)
}

// ─── Hook ───

/**
 * 综合判断设备类型，结合：UserAgent、触摸能力、指针精度、视口宽度。
 *
 * 优先级：
 * 1. UA 明确标识手机 → mobile（无视口大小）
 * 2. UA 明确标识平板 → tablet（无视口大小）
 * 3. pointer: coarse + 无 fine → 触控设备 → 按宽度 tablet/mobile
 * 4. 不支持 hover + 支持 touch → 触控设备 → 按宽度 tablet/mobile
 * 5. fallback → 按视口宽度
 *
 * 需在 `<DeviceTypeProvider>` 子树内使用。
 */
export function useDeviceType(): DeviceInfo {
  return useContext(DeviceTypeContext)
}
