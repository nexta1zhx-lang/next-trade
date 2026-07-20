'use client'

import {ClipboardList} from 'lucide-react'

export default function OrdersPage() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground px-6">
      <ClipboardList className="w-16 h-16 mb-4 opacity-20" />
      <h2 className="text-lg font-medium text-foreground mb-1">订单分析</h2>
      <p className="text-sm text-center max-w-sm">
        订单历史与分析功能开发中，敬请期待。
      </p>
    </div>
  )
}
