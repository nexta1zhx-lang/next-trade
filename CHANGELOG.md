# nextTrade 更新日志

## [0.1.0] - 2026-07-28

### 🎉 初始版本

#### ✨ 新功能

- **多交易所行情聚合** — 支持 Binance、OKX、Bybit、Bitget、Gate.io、MEXC 六大交易所实时行情
- **每日行情分析** — 全市场振幅榜、涨幅榜、跌幅榜、十字星识别，自定义成交额过滤
- **实盘订阅** — 实时追踪关注的交易对，自定义价格提醒
- **合约持仓监控** — 多交易所合约持仓一览，开仓均价、盈亏、清算价实时追踪
- **资产全景分析** — 5 分钟高频资产快照，资金/现货/合约多维度资产透视
- **系统设置** — API Key 管理、K 线模式切换、数据筛选配置

#### 🔧 技术架构

- 前端: Next.js 16 (App Router) + TailwindCSS v4 + Recharts
- 后端: Hono.js + Drizzle ORM + PostgreSQL 16 + Redis 7
- 实时推送: WebSocket + SSE 双通道
- 移动端: Capacitor 8 Android 原生封装
- 部署: Docker Compose + Caddy 自动 HTTPS

#### 📱 Android App

- Capacitor 封装的原生 Android 体验
- 触控优化、安全区域适配
- API Key AES-256-GCM 本地加密存储

#### 🔒 安全

- API Key 仅使用只读权限
- AES-256-GCM 加密存储
- JWT + Web3 钱包双认证
