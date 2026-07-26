#!/bin/bash
# 手动触发成交同步
# 用法: ./scripts/sync-trades.sh <keyId> [startDate] [endDate]
# 示例: ./scripts/sync-trades.sh 2 2026-07-01 2026-07-08

API="http://localhost:3001/api/v1/trades/sync"
# 从本地存储取 token，或直接传参
TOKEN="${NEXTTRADE_TOKEN}"

if [ -z "$TOKEN" ]; then
  # 从 localStorage 读（需要先运行 dev 页面登录后）
  echo "请先设置 token: export NEXTTRADE_TOKEN='你的JWT'"
  echo "或在浏览器登录后从 localStorage 复制: localStorage.getItem('nexttrade_token')"
  exit 1
fi

KEY_ID="${1:-2}"
START="${2}"
END="${3}"

BODY="{\"keyId\":$KEY_ID"
[ -n "$START" ] && BODY+=",\"startDate\":\"$START\""
[ -n "$END" ] && BODY+=",\"endDate\":\"$END\""
BODY+="}"

echo "请求: POST $API"
echo "参数: $BODY"
echo "---"

curl -s -X POST "$API" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool 2>/dev/null || cat
