'use client'

import {TrendingUp} from 'lucide-react'

export default function FuturesPage() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground px-6">
      <TrendingUp className="w-16 h-16 mb-4 opacity-20" />
      <h2 className="text-lg font-medium text-foreground mb-1">合约实盘</h2>
      <p className="text-sm text-center max-w-sm">
        实盘交易功能开发中，敬请期待。
      </p>
    </div>
  )
}
