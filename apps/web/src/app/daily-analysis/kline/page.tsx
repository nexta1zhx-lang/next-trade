'use client'

import {Suspense, useMemo, useEffect} from 'react'
import {useSearchParams, useRouter} from 'next/navigation'
import type {DailyAnalysisItem} from '@nexttrade/shared'
import dynamic from 'next/dynamic'

const SymbolDetail = dynamic(() => import('../SymbolDetail'), {ssr: false})

function parseBase(symbol: string): string {
  // BTC/USDT:USDT → BTC
  return symbol.replace('/USDT:USDT', '').replace('USDT', '')
}

function KlineContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const symbol = searchParams?.get('symbol') ?? null
  const date = searchParams?.get('date') || ''

  const item: DailyAnalysisItem | null = useMemo(() => {
    if (!symbol) return null
    return {
      symbol,
      base: parseBase(symbol),
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      amplitude: 0,
      change: 0,
      quoteVolume: 0,
      isDoji: false
    }
  }, [symbol])

  const handleBack = useMemo(() => {
    return () => router.replace('/daily-analysis')
  }, [router])

  // Android 硬件返回键/手势滑动返回 → 回到行情筛选页
  useEffect(() => {
    const onPopState = () => {
      router.replace('/daily-analysis')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [router])

  if (!symbol || !item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        缺少币种参数
      </div>
    )
  }

  return (
    <div className="h-full">
      <SymbolDetail item={item} selectedDate={date} onClose={handleBack} />
    </div>
  )
}

export default function KlinePage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-gray-500 text-sm">
          加载中...
        </div>
      }
    >
      <KlineContent />
    </Suspense>
  )
}
