这是一份为你量身定制的工业级 GitHub `README.md` 文档，包含了项目架构、核心特性、数据工作流和部署指南。你可以直接复制使用：

---

# 🎯 nextTrade — PA 动能雷达与点位碰撞引擎 (LevelStrike Engine)

`LevelStrike Engine` 是 **nextTrade** 平台的核心量化监控模块。它通过“每日 PA 异动过滤 ➔ 动态点位算子 ➔ WebSocket 毫秒级碰撞 ➔ 声光实时告警”的闭环架构，帮助交易员与量化策略自动捕捉全市场高波幅、高动能代币的关键突破与回调机会。

---

## 🏛️ 架构与技术栈

本模块集成于 Monorepo 统一架构中：

```text
nextTrade/
├── apps/api           # Hono.js 后端应用 (PA 过滤、算子引擎、WS 监听、SSE 告警)
├── apps/web           # Next.js 16 前端应用 (Lightweight Charts 多图看板、Web Audio)
└── packages/shared    # 共享类型与配置 (Zod Schemas, Contract Types)

```

| 维度                | 技术选型                                 | 用途说明                                  |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| **数据采集**        | `ccxt`                                   | 统一获取 Binance U本位永续合约行情与 K 线 |
| **PA 指标计算**     | `technicalindicators`                    | 15m ATR、布林带挤压 (Squeeze)、VWAP 计算  |
| **存储 & 观察池**   | `Drizzle ORM` + `PostgreSQL` / `ioredis` | 异动数据归档 + Redis 实时 Hash 观察池     |
| **实时碰撞引擎**    | `ws` + `reconnecting-websocket`          | 动态订阅按需 Token 0.1s 级行情流          |
| **前端看板 & 图表** | `Next.js 16` + `lightweight-charts`      | 高性能 Canvas 渲染 + 关键点位 Line 绘制   |
| **声光告警**        | `Web Audio API` + `Sonner`               | 浏览器端纯算力双音调音效合成与 Toast      |

---

## ⚡ 核心功能特性

1. **多重 PA 行情过滤（每天定时触发）：**

- 自动过滤全市场成交额 `< $20M` 的死盘与稳定币对。
- 计算振幅 (Amplitude)、15m ATR 扩张度及布林带与肯特纳通道挤压状态 (Squeeze)。
- 综合得分自动挑选 Top 5–10 最具交易价值的热点币种。

2. **动态观察池与结构点位算子：**

- 自动计算当天关键结构点位：`Day High / Day Low`、`VWAP` 及 `Fibonacci 0.382 / 0.618` 回调位。
- 支持固定置顶标的（如 `BTC` / `ETH`）与动态异动山寨币组合存储。

3. **按需 WebSocket 实时碰撞引擎：**

- **极低开销：** 仅向币安订阅 Redis 观察池中的 10 个币种，拒绝带宽浪费。
- **碰撞触发：** 毫秒级监控“突破 Day High 放量”、“VWAP 缩量支撑”与“Squeeze 挤压突破”。
- **防抖冷却 (Cooldown)：** 内置 3 分钟信号去重锁，防止行情剧烈波动时重复轰炸。

4. **纯价格极简看板与声光告警：**

- 基于 TradingView Lightweight Charts 实时绘制 K 线与动态警戒线。
- 无外部音频文件的原生 Web Audio 音效，不同告警触发不同声调。
- 告警触发时，前端卡片边框高亮脉冲闪烁。

---

## 🔄 数据工作流 (Data Workflow)

```text
┌─────────────────────────┐
│  Binance 24h Ticker &   │
│      15m Klines         │
└────────────┬────────────┘
             │ (每日 00:05 UTC 定时触发)
             ▼
┌─────────────────────────┐     归档历史     ┌─────────────────────────┐
│   PA Filter & Scoring   ├─────────────────►│   PostgreSQL (Drizzle)  │
└────────────┬────────────┘                  └─────────────────────────┘
             │ 刷新 Top 10 观察池与点位
             ▼
┌─────────────────────────┐
│ Redis Hash Observation  │
│ (market:watchlist:active│
└────────────┬────────────┘
             │ 读取 Symbol 列表并建立按需订阅
             ▼
┌─────────────────────────┐     触发碰撞     ┌─────────────────────────┐
│ WebSocket Stream Engine ├─────────────────►│ Redis Pub/Sub & Hono SSE│
└─────────────────────────┘  (冷却锁 3 min)   └────────────┬────────────┘
                                                          │ 实时推送
                                                          ▼
                                             ┌─────────────────────────┐
                                             │ Next.js 16 Canvas Dashboard│
                                             │ (Sound + Visual Alarm)  │
                                             └─────────────────────────┘

```

---

## 🚀 快速开始与环境配置

### 1. 环境变量配置

在 `apps/api/.env` 中新增：

```env
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/nexttrade
REDIS_URL=redis://localhost:6379
BINANCE_API_KEY=your_key_here          # 可选 (公共行情接口无需 Key)
BINANCE_SECRET_KEY=your_secret_here    # 可选

```

### 2. 安装依赖并初始化

```bash
# 根目录下安装全栈依赖
pnpm install

# 数据库 Migration
pnpm --filter api db:generate
pnpm --filter api db:push

```

### 3. 启动开发服务

```bash
# 同时启动后端 API (Port 3001) 与前端 Dashboard (Port 3000)
pnpm dev

```

---

## 📡 关键 API 路由参考

| 方法   | 路由                       | 说明                                          |
| ------ | -------------------------- | --------------------------------------------- |
| `GET`  | `/api/v1/market/watchlist` | 获取当前 Redis 激活的 Top 10 观察池与计算点位 |
| `POST` | `/api/v1/market/sync-pa`   | 手动强制触发一次全市场 PA 过滤与点位重新计算  |
| `GET`  | `/api/v1/stream/alerts`    | SSE (Server-Sent Events) 实时告警长连接通道   |

---

## 📝 开源协议

本项目基于 **MIT License** 许可协议。
