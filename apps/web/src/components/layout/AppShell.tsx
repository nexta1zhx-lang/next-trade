'use client'

import {usePathname, useRouter} from 'next/navigation'
import {useState, useCallback, useEffect} from 'react'
import {
  BarChart3,
  TrendingUp,
  Activity,
  Settings2,
  AreaChart,
  Wallet
} from 'lucide-react'
import type {ReactNode} from 'react'

interface NavItem {
  label: string
  href: string
  icon: typeof Activity
}

const NAV_ITEMS: NavItem[] = [
  {label: '每日行情', href: '/daily-analysis', icon: BarChart3},
  {label: '实盘订阅', href: '/analysis', icon: AreaChart},
  {label: '合约实盘', href: '/futures', icon: TrendingUp},
  {label: '资产概况', href: '/asset', icon: Wallet},
  {label: '系统设置', href: '/settings', icon: Settings2}
]

export function AppShell({children}: {children: ReactNode}) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeIndex = NAV_ITEMS.findIndex(item =>
    pathname.startsWith(item.href)
  )

  const navigate = useCallback(
    (href: string) => {
      router.push(href)
      setSidebarOpen(false)
    },
    [router]
  )

  // 路由变化时关闭侧栏
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* ─── PC 全宽侧边栏 (lg+) ─── */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:h-screen lg:sticky lg:top-0 border-r border-border bg-card">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-5 border-b border-border">
          <Activity className="w-5 h-5 text-primary" />
          <span className="font-bold text-sm tracking-tight">nextTrade</span>
        </div>

        {/* 导航 */}
        <nav className="flex-1 flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item, i) => {
            const active = i === activeIndex
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left
                  ${
                    active
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <p className="text-[10px] text-muted-foreground">nextTrade v0.1</p>
        </div>
      </aside>

      {/* ─── 平板图标侧边栏 (md ~ lg) ─── */}
      <aside className="hidden md:flex lg:hidden md:flex-col md:w-16 md:h-screen md:sticky md:top-0 border-r border-border bg-card">
        {/* Logo */}
        <div className="h-14 flex items-center justify-center border-b border-border">
          <Activity className="w-5 h-5 text-primary" />
        </div>

        {/* 导航 */}
        <nav className="flex-1 flex flex-col items-center gap-1 p-2">
          {NAV_ITEMS.map((item, i) => {
            const active = i === activeIndex
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                title={item.label}
                className={`flex items-center justify-center w-11 h-11 rounded-lg transition-all
                  ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ─── 主内容区 ─── */}
      <main className="flex-1 min-h-screen pb-16 md:pb-0 safe-bottom">
        {children}
      </main>

      {/* ─── 移动端底部导航 (< md) ─── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-card border-t border-border safe-bottom">
        <div className="flex">
          {NAV_ITEMS.map((item, i) => {
            const active = i === activeIndex
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[10px] transition-colors active:scale-95
                  ${active ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
