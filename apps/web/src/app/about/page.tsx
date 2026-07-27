'use client'

import {useMemo} from 'react'
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
  Github,
  ChevronRight,
  BarChart3,
  LineChart,
  Zap,
  Lock,
  RefreshCw,
  Layers,
  Eye,
  Clock,
  Sparkles
} from 'lucide-react'

// ─── 版本信息 ───
const APP_VERSION = '0.1.0'
const APP_BUILD = 1
const IS_DEV =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1')
// 开发环境显示开发版 APK，生产环境显示生产版 APK
const APK_URL = IS_DEV
  ? '/downloads/nexttrade-v0.1.0-dev.apk'
  : '/downloads/nexttrade-v0.1.0.apk'
const APK_LABEL = IS_DEV ? '下载 Android APK（开发版）' : '下载 Android APK'

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
interface Advantage {
  label: string
  value: string
}

const ADVANTAGES: Advantage[] = [
  {label: '架构', value: 'Next.js 16 + Hono.js 前后端分离'},
  {label: '数据库', value: 'PostgreSQL 16 + Drizzle ORM'},
  {label: '缓存', value: 'Redis 7（行情缓存 + Pub/Sub 推送）'},
  {label: '实时推送', value: 'WebSocket + SSE 双通道'},
  {label: '容器化', value: 'Docker Compose 一键部署'},
  {label: '反向代理', value: 'Caddy（自动 HTTPS / SSL）'},
  {label: '移动端', value: 'Capacitor 8 + Android 原生'},
  {label: '语言', value: 'TypeScript 全栈（Monorepo）'}
]

// ─── 更新日志 ───
interface ChangelogEntry {
  version: string
  date: string
  items: string[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-07-28',
    items: [
      '🎉 初始版本发布',
      '多交易所行情聚合与实时推送',
      '每日行情分析（振幅榜/涨幅榜/十字星识别）',
      '合约实盘多交易所持仓监控',
      '资产全景 5 分钟高频快照',
      'Web3 钱包 + 邮箱双认证登录',
      'Android APK 原生 App 发布'
    ]
  }
]

// ─── 下载信息 ───
interface DownloadInfo {
  platform: string
  icon: typeof Download
  label: string
  url: string
  size: string
  version: string
  date: string
}

const DOWNLOADS: DownloadInfo[] = [
  {
    platform: 'Android',
    icon: Smartphone,
    label: APK_LABEL,
    url: APK_URL,
    size: '~25 MB',
    version: IS_DEV ? `v${APP_VERSION}-dev` : `v${APP_VERSION}`,
    date: '2026-07-28'
  }
]

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
    <div
      className={`group relative rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5`}
    >
      {/* 渐变色背景 */}
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

function DownloadCard({info}: {info: DownloadInfo}) {
  const Icon = info.icon
  return (
    <a
      href={info.url}
      download
      className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground">
            {info.label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            {info.version}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{info.size}</span>
          <span>·</span>
          <span>更新于 {info.date}</span>
          <span>·</span>
          <span className="flex items-center gap-0.5 text-primary group-hover:underline">
            下载 <ExternalLink className="w-3 h-3" />
          </span>
        </div>
      </div>
    </a>
  )
}

function ChangelogSection() {
  return (
    <div>
      <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        更新日志
      </h2>
      <div className="space-y-4">
        {CHANGELOG.map(entry => (
          <div
            key={entry.version}
            className="relative pl-6 border-l-2 border-border"
          >
            {/* 时间轴圆点 */}
            {/* 使用 left-0 + translate 代替 -left-[9px] 以满足 Tailwind v4 */}
            <div className="absolute left-0 top-0 -translate-x-1/2 w-4 h-4 rounded-full bg-card border-2 border-primary" />

            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-bold text-foreground">
                v{entry.version}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {entry.date}
              </span>
            </div>
            <ul className="space-y-1">
              {entry.items.map((item, i) => (
                <li
                  key={i}
                  className="text-xs text-muted-foreground flex items-start gap-2"
                >
                  <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-primary/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-10">
      {/* ─── Hero ─── */}
      <section className="text-center pt-8 md:pt-16 pb-4">
        {/* Logo + 名称 */}
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Activity className="w-7 h-7 text-white" />
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              nextTrade
            </h1>
            <p className="text-xs text-muted-foreground">
              AI 辅助的 Web3 + CEX 量化交易平台
            </p>
          </div>
        </div>

        {/* 标语 */}
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed mb-8">
          实时聚合多家主流交易所行情数据，提供专业级行情分析、合约持仓监控、
          资产全景管理，让交易决策更加高效
        </p>

        {/* CTA 按钮 */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href={APK_URL}
            download
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Download className="w-4 h-4" />
            {APK_LABEL}
          </a>
          <a
            href="/daily-analysis"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:bg-muted/50 transition-colors"
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
        <div className="space-y-3">
          {DOWNLOADS.map(info => (
            <DownloadCard key={info.platform} info={info} />
          ))}
        </div>

        {/* 安装说明 */}
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
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
                {typeof window !== 'undefined' ? window.location.hostname : ''}
              </code>{' '}
              — {IS_DEV ? '开发版，连接本地 API' : '生产版，连接正式服务器'}
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
          nextTrade v{APP_VERSION} (Build {APP_BUILD}) &middot;{' '}
          {new Date().getFullYear()} &middot; 仅供个人交易参考，不构成投资建议
        </p>
      </footer>
    </div>
  )
}
