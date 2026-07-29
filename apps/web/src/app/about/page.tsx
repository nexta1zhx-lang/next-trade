'use client'

import {useState, useEffect} from 'react'
import {
  Activity,
  TrendingUp,
  Wallet,
  Shield,
  Cpu,
  Globe,
  Smartphone,
  Download,
  ExternalLink,
  ChevronRight,
  BarChart3,
  LineChart,
  Zap,
  Eye,
  Clock,
  Sparkles
} from 'lucide-react'

// ─── 特性列表 ───
interface Feature {
  icon: typeof Activity
  title: string
  desc: string
}

const FEATURES: Feature[] = [
  {
    icon: Globe,
    title: '多交易所聚合',
    desc: '同时接入 Binance、OKX、Bybit、Bitget、Gate.io、MEXC 六大主流交易所，统一管理所有资产与仓位'
  },
  {
    icon: LineChart,
    title: '实时行情追踪',
    desc: 'WebSocket 实时推送全市场 Ticker，K 线图表支持多时间维度，振幅榜/涨幅榜一目了然'
  },
  {
    icon: Wallet,
    title: '资产全景分析',
    desc: '5 分钟高频资产快照，支持资金账户、现货、U 本位合约、币本位合约、理财多维度资产透视'
  },
  {
    icon: TrendingUp,
    title: '合约实盘监控',
    desc: '实时持仓追踪，盈亏统计，开仓均价/ liquidation 价格一目了然，支持多交易所同时监控'
  },
  {
    icon: BarChart3,
    title: '每日行情分析',
    desc: '全市场每日振幅/涨跌排行，十字星识别，自定义成交额过滤，辅助识别交易机会'
  },
  {
    icon: Shield,
    title: '安全可控',
    desc: 'API Key 本地 AES-256-GCM 加密存储，仅使用只读权限，资金始终由交易所托管'
  },
  {
    icon: Cpu,
    title: 'AI 辅助决策',
    desc: '基于市场数据的智能分析，识别潜在交易信号，辅助制定交易策略'
  },
  {
    icon: Smartphone,
    title: '移动端原生体验',
    desc: 'Capacitor 封装的 Android 原生 App，支持离线缓存，触控优化，安全区域适配'
  }
]

// ─── 技术优势 ───
const ADVANTAGES = [
  {label: '架构', value: 'Next.js 16 + Hono.js 前后端分离'},
  {label: '数据库', value: 'PostgreSQL 16 + Drizzle ORM'},
  {label: '缓存', value: 'Redis 7（行情缓存 + Pub/Sub 推送）'},
  {label: '实时推送', value: 'WebSocket + SSE 双通道'},
  {label: '容器化', value: 'Docker Compose 一键部署'},
  {label: '反向代理', value: 'Caddy（自动 HTTPS / SSL）'},
  {label: '移动端', value: 'Capacitor 8 + Android 原生'},
  {label: '语言', value: 'TypeScript 全栈（Monorepo）'}
]

// ─── 更新日志类型 ───
interface ChangelogEntry {
  version: string
  build: number
  date: string
  items: string[]
}

interface VersionInfo {
  latest: string
  build: number
  apkUrl: string
  releaseDate: string
}

// ─── 统计数字 ───
const STATS = [
  {label: '支持的交易所', value: '6'},
  {label: '监控交易对', value: '200+'},
  {label: '数据更新频率', value: '实时'},
  {label: '资产快照频率', value: '5 分钟'}
]

// ─── 渐变色类名映射 ───
const GRADIENT_MAP: Record<number, string> = {
  0: 'from-blue-500/20 to-cyan-500/20',
  1: 'from-emerald-500/20 to-teal-500/20',
  2: 'from-violet-500/20 to-purple-500/20',
  3: 'from-orange-500/20 to-amber-500/20',
  4: 'from-rose-500/20 to-pink-500/20',
  5: 'from-indigo-500/20 to-blue-500/20',
  6: 'from-cyan-500/20 to-sky-500/20',
  7: 'from-green-500/20 to-emerald-500/20'
}

function FeatureCard({feature, index}: {feature: Feature; index: number}) {
  const Icon = feature.icon
  return (
    <div className="group relative rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
      <div
        className={`absolute inset-0 rounded-xl bg-linear-to-br ${GRADIENT_MAP[index % 8]} opacity-0 group-hover:opacity-100 transition-opacity`}
      />
      <div className="relative z-10">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground mb-1.5">
          {feature.title}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {feature.desc}
        </p>
      </div>
    </div>
  )
}

function ChangelogSection() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  useEffect(() => {
    fetch('/downloads/changelog.json')
      .then(r => r.json())
      .then(setEntries)
      .catch(() => {})
  }, [])

  if (entries.length === 0) return null

  return (
    <div>
      <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        更新日志
      </h2>
      <div className="space-y-4">
        {entries.map(entry => {
          const apkName = `nexttrade-v${entry.version}-b${entry.build}.apk`
          return (
            <div
              key={entry.version}
              className="relative pl-6 border-l-2 border-border"
            >
              <div className="absolute left-0 top-0 -translate-x-1/2 w-4 h-4 rounded-full bg-card border-2 border-primary" />
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-bold text-foreground">
                  v{entry.version}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {entry.date}
                </span>
                <a
                  href={`/downloads/${apkName}`}
                  download
                  className="ml-auto text-[10px] text-primary hover:underline flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  下载 APK
                </a>
              </div>
              <ul className="space-y-1">
                {entry.items.slice(0, 5).map((item, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground flex items-start gap-2"
                  >
                    <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-primary/60" />
                    {item}
                  </li>
                ))}
                {entry.items.length > 5 && (
                  <li className="text-xs text-gray-500 flex items-start gap-2">
                    <span className="w-3 shrink-0 text-center">···</span>
                    还有 {entry.items.length - 5} 条更新
                  </li>
                )}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function IntroPage() {
  const [mounted, setMounted] = useState(false)
  const [isDev, setIsDev] = useState(false)
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([])

  useEffect(() => {
    const dev =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    setIsDev(dev)
    setMounted(true)
  }, [])

  // 加载版本信息和更新日志（加时间戳防缓存）
  useEffect(() => {
    const ts = Date.now()
    fetch('/downloads/versions.json?t=' + ts)
      .then(r => r.json())
      .then(setVersion)
      .catch(() => {})
    fetch('/downloads/changelog.json?t=' + ts)
      .then(r => r.json())
      .then(setChangelog)
      .catch(() => {})
  }, [])

  const latestVersion = version?.latest ?? ''
  const apkUrl = version?.apkUrl ?? ''
  const apkLabel = isDev
    ? `下载 Android APK v${latestVersion}（开发版）`
    : `下载 Android APK v${latestVersion}`
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── 顶部导航条 ─── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md safe-top">
        <div className="max-w-5xl mx-auto flex items-center justify-between h-14 px-4">
          <a href="/介绍" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight">nextTrade</span>
          </a>
          <nav className="flex items-center gap-1">
            <a
              href="/daily-analysis"
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              在线体验
            </a>
            <a
              href={mounted ? apkUrl : '#'}
              download
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              {mounted ? apkLabel : '下载 APK'}
            </a>
          </nav>
        </div>
      </header>

      {/* ─── 主内容 ─── */}
      <div className="max-w-4xl mx-auto px-4 space-y-10 pb-10">
        {/* ─── Hero ─── */}
        <section className="text-center pt-12 md:pt-20 pb-4">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Activity className="w-8 h-8 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-3xl font-bold text-foreground tracking-tight">
                nextTrade
              </h1>
              <p className="text-sm text-muted-foreground">
                AI 辅助的 Web3 + CEX 量化交易平台
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed mb-8">
            实时聚合多家主流交易所行情数据，提供专业级行情分析、合约持仓监控、
            资产全景管理，让交易决策更加高效
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href={mounted ? apkUrl : '#'}
              download
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" />
              {mounted ? apkLabel : '下载 APK'}
            </a>
            <a
              href="/daily-analysis"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <Eye className="w-4 h-4" />
              在线体验
            </a>
          </div>
        </section>

        {/* ─── 统计数据 ─── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATS.map(stat => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-card p-4 text-center"
            >
              <div className="text-xl font-bold text-primary mb-1">
                {stat.value}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {stat.label}
              </div>
            </div>
          ))}
        </section>

        {/* ─── 功能介绍 ─── */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            功能特性
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {FEATURES.map((feature, i) => (
              <FeatureCard key={feature.title} feature={feature} index={i} />
            ))}
          </div>
        </section>

        {/* ─── 技术栈 ─── */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            技术架构
          </h2>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {ADVANTAGES.map(adv => (
                <div key={adv.label}>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    {adv.label}
                  </div>
                  <div className="text-xs text-foreground font-medium">
                    {adv.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 下载区域 ─── */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            下载与安装
          </h2>

          {version && (
            <a
              href={mounted ? apkUrl : '#'}
              download
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer mb-3"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
                <Smartphone className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground">
                    {mounted ? apkLabel : '下载 APK'}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    v{version.latest}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>Build {version.build}</span>
                  <span>·</span>
                  <span>更新于 {version.releaseDate.slice(0, 10)}</span>
                  <span>·</span>
                  <span className="flex items-center gap-0.5 text-primary group-hover:underline">
                    下载 <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </a>
          )}

          {/* ─── 历史版本列表 ─── */}
          {changelog.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 mb-3">
              <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-primary" />
                历史版本
              </h3>
              <div className="space-y-2">
                {changelog.map(entry => {
                  const apkName = `nexttrade-v${entry.version}-b${entry.build}.apk`
                  const isLatest =
                    entry.version === version?.latest &&
                    entry.build === version?.build
                  return (
                    <div
                      key={`${entry.version}-${entry.build}`}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">
                          v{entry.version}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Build {entry.build}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {entry.date}
                        </span>
                        {isLatest && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                            最新
                          </span>
                        )}
                      </div>
                      <a
                        href={`/downloads/${apkName}`}
                        download
                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        下载
                      </a>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" />
              安装说明
            </h3>
            <ol className="space-y-1.5 text-[11px] text-muted-foreground list-decimal list-inside">
              <li>下载 APK 文件到手机</li>
              <li>在文件管理器中点击 APK 文件安装</li>
              <li>
                如提示"未知来源应用"，前往设置 → 安全 → 允许安装未知来源应用
              </li>
              <li>安装完成后打开 App，登录即可使用</li>
            </ol>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-muted-foreground">
              <p>
                当前环境:{' '}
                <code className="text-[10px] bg-muted px-1 rounded">
                  {mounted ? window.location.hostname : ''}
                </code>{' '}
                — {isDev ? '开发版，连接本地 API' : '生产版，连接正式服务器'}
              </p>
            </div>
          </div>
        </section>

        {/* ─── 更新日志 ─── */}
        <section>
          <ChangelogSection />
        </section>

        {/* ─── Footer ─── */}
        <footer className="text-center pt-4 pb-8 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            nextTrade v{version?.latest ?? '—'} (Build {version?.build ?? '—'})
            &middot; {new Date().getFullYear()} &middot;
            仅供个人交易参考，不构成投资建议
          </p>
        </footer>
      </div>
    </div>
  )
}
