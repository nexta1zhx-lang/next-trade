/**
 * WebSocket 用户数据流服务 — 委托给 ingestion/wsIngestor
 *
 * 重构后: 本文件作为兼容层，实际逻辑在 src/ingestion/wsIngestor.ts
 * 对外接口不变: subscribeClient / unsubscribeClient
 */
export {
  subscribeClient,
  unsubscribeClient
} from '../ingestion/wsIngestor.js'
