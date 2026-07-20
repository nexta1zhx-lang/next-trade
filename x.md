┌──────────────────────────────────────────────────────────────────┐
│ 前端 UI 层 (apps/web) │
│ Next.js 16 (App Router) + TailwindCSS v4 + Shadcn UI + Recharts│
│ · Wagmi / Viem (钱包连接 & 链上交互) │
└─────────────────────────────────────────┬────────────────────────┘
│ HTTP / WebSocket
┌─────────────────────────────────────────▼────────────────────────┐
│ 后端 API 层 (apps/api - Hono.js) │
│ Hono.js + TypeScript (独立部署) │
│ · Auth: NextAuth.js / Dynamic.xyz (Web3 签名登录) │
│ · ORM: Drizzle ORM + PostgreSQL / Supabase │
│ · Cache & Pub/Sub: Redis (行情缓存与实时推送) │
│ · WebSocket: 交易所行情推送 → 前端 │
└─────────────────┬───────────────────────┬────────────────────────┘
│ │
┌─────────────────▼───────────────┐ ┌─────▼────────────────────────┐
│ 交易所 & 数据 Sync Engine │ │ 链上资产数据层 │
│ · CCXT (Binance/OKX REST&WS) │ │ · DeBank / Zerion API │
│ · Coinglass / CoinGecko (行情) │ │ · 链上持仓 & 历史交易 │
└─────────────────────────────────┘ └──────────────────────────────┘
