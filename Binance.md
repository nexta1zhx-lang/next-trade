你是一个专业的币安（Binance）交易 Agent。

工作机制：
如果遇到API 节点或参数规则，请先检索 llms.txt 了解币安最新的文档规范。
若有 去除币安 sdk的逻辑，采用原生请求
根据接口的的查询速率进行限制，避免触发币安的风控机制。

# WebSocket Base URL 迁移公告（重要变更）

## 变更背景

由于现有 WebSocket 服务流量持续升高，我们对 WebSocket URL 结构进行了拆分与升级：以 **Root**
作为根路径，并新增 **Public / Market / Private**
三类入口，供不同频率与类型的数据分别接入，从而提升整体稳定性与可扩展性。

## 变更摘要（What’s New）

- **新增 3 个 WebSocket Base URL（Root + 分流路径）**
  - Public（高频公共行情/盘口）：`wss://fstream.binance.com/public`
  - Market（常规公共市场数据）：`wss://fstream.binance.com/market`
  - Private（用户私有数据）：`wss://fstream.binance.com/private`
- **支持两种访问模式**
  - `ws` 模式：使用 URL path 拼接订阅流
  - `stream` 模式：使用 `?streams=`（或 private 的 `listenKey/events`）参数传入订阅流
- **继续支持 Combined Streams（组合订阅）**
- **Private 维度支持 listenKey + events 订阅方式（可多 listenKey、多 event）**

## 新 URL 使用方式（Examples）

### Public / Market：组合订阅

- `ws` 模式（path 拼接）
  - `wss://fstream.binance.com/public/ws/bnbusdt@depth/ethusdt@depth`
  - `wss://fstream.binance.com/market/ws/btcusdt@aggTrade/ethusdt@aggTrade`
- `stream` 模式（query 传 streams）
  - `wss://fstream.binance.com/market/stream?streams=bnbusdt@aggTrade/btcusdt@markPrice`
  - `wss://fstream.binance.com/public/stream?streams=btcusdt@depth/ethusdt@depth`

### Private：listenKey & events

- `ws` 模式（示例：listenKey + events）
  - `wss://fstream.binance.com/private/ws?listenKey=<listenKey1>&events=ORDER_TRADE_UPDATE/ACCOUNT_UPDATE`
- `stream` 模式（示例：多 listenKey + 多 events）
  - `wss://fstream.binance.com/private/stream?listenKey=<listenKey1>&events=ORDER_TRADE_UPDATE&listenKey=<listenKey2>&events=ACCOUNT_UPDATE`

> 也支持使用 JSON `SUBSCRIBE` 请求订阅流（params 中可混合 market/public stream 与 listenKey 事件）。

## Endpoint 与 Stream 映射（摘录）

### Public（高频公共数据）

- Individual Symbol Book Ticker：`<symbol>@bookTicker`
- All Book Tickers：`!bookTicker`
- Partial Book Depth：`<symbol>@depth<levels>`（支持 `@500ms` / `@100ms`）
- Diff. Book Depth：`<symbol>@depth`（支持 `@500ms` / `@100ms`）

### Market（常规市场数据）

- Aggregate Trade：`<symbol>@aggTrade`
- Mark Price：`<symbol>@markPrice` 或 `<symbol>@markPrice@1s`
- Mark Price (All market)：`!markPrice@arr` 或 `!markPrice@arr@1s`
- Kline/Candlestick：`<symbol>@kline_<interval>`
- Continuous Kline：`<pair>_<contractType>@continuousKline_<interval>`
- Mini Ticker：`<symbol>@miniTicker`；All mini ticker：`!miniTicker@arr`
- Ticker：`<symbol>@ticker`；All ticker：`!ticker@arr`
- Liquidation Order：`<symbol>@forceOrder`；All：`!forceOrder@arr`
- Composite Index：`<symbol>@compositeIndex`
- Contract Info：`!contractInfo`
- Multi-Assets Mode Asset Index：`!assetIndex@arr` 或 `<assetSymbol>@assetIndex`

## 兼容性与迁移建议（Migration）

- **旧 URL 将继续可用至 2026-04-23**，届时将被永久下线。建议用户在此日期前完成迁移到新的
  `/public`、`/market`、`/private` 入口。
- **升级完成后，未迁移的连接将仅能接收 `wss://fstream.binance.com/public` 下的数据。`/market` 和
  `/private` 下的频道将停止推送数据。** 例如，`wss://fstream.binance.com/ws/btcusdt@depth`
  仍可正常接收数据，但 `wss://fstream.binance.com/ws/btcusdt@markPrice` 将无法接收。
- 迁移优先级建议：
  1. 高频盘口/核心公共数据 → 迁移到 `/public`
  2. 常规市场数据（markPrice/kline/ticker 等）→ 迁移到 `/market`
  3. 用户数据（listenKey 相关）→ 迁移到 `/private`
- 客户端 SDK/连接管理建议：
  - 建议按数据类型拆分连接（public/market/private 分开建连），降低单连接负载与抖动风险。
  - 如需组合订阅，优先使用 `stream` 模式的 `?streams=`
    管理订阅列表（private 按 listenKey/events 管理）。

## 行动项（Action Required）

- 请评估并更新你们的 WebSocket 连接配置：
  - 将 Base URL 替换为新的 `/public`、`/market`、`/private`
  - 确认订阅 stream 名称与所属入口一致（Public vs Market vs Private）
- **请在 2026-04-23 前完成迁移。**
  届时旧 URL（`wss://fstream.binance.com/ws`、`wss://fstream.binance.com/stream`）将不再可用。

# 时间偏差问题注意
