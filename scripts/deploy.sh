#!/usr/bin/env bash
set -euo pipefail

# ─── nextTrade 一键部署脚本 ──────────────────────────────
# 用法:
#   ./scripts/deploy.sh              # 全量构建+部署
#   ./scripts/deploy.sh api          # 只重建 api
#   ./scripts/deploy.sh web          # 只重建 web
#   ./scripts/deploy.sh --db-push    # 构建+部署+数据库迁移
#   ./scripts/deploy.sh api --db-push
# ─────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.prod.yml"
SERVICE="${1:-}"          # 可选: api / web
DB_PUSH=false

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --db-push) DB_PUSH=true ;;
    api|web)   SERVICE="$arg" ;;
  esac
done

echo "========================================"
echo " nextTrade 部署开始"
echo " 时间: $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ─── 1. 拉取最新代码 ───
echo ""
echo "▶ 拉取最新代码..."
git pull

# ─── 2. 构建并启动 ───
echo ""
if [ -n "$SERVICE" ]; then
  echo "▶ 单独构建 [$SERVICE]..."
  docker compose -f "$COMPOSE_FILE" up -d --build "$SERVICE"
else
  echo "▶ 全量构建所有服务..."
  docker compose -f "$COMPOSE_FILE" up -d --build
fi

# ─── 3. 等待就绪 ───
echo ""
echo "▶ 等待服务就绪..."
if [ -z "$SERVICE" ] || [ "$SERVICE" = "api" ]; then
  for i in $(seq 1 30); do
    if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
      echo "  ✓ API 就绪"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "  ⚠ API 未响应，请检查日志: docker compose -f $COMPOSE_FILE logs api"
    fi
    sleep 1
  done
fi

# ─── 4. 数据库迁移（可选） ───
if [ "$DB_PUSH" = true ]; then
  echo ""
  echo "▶ 执行数据库迁移..."
  docker compose -f "$COMPOSE_FILE" exec -T api pnpm run db:push
  echo "  ✓ 数据库迁移完成"
fi

# ─── 5. 清理旧镜像 ───
echo ""
echo "▶ 清理旧镜像..."
docker image prune -f > /dev/null 2>&1 && echo "  ✓ 旧镜像已清理"

echo ""
echo "========================================"
echo " 部署完成 ✓"
echo "========================================"
echo ""
echo "  API:  http://localhost:3001/health"
echo "  Web:  http://localhost:3000"
echo ""
echo " 日志: docker compose -f $COMPOSE_FILE logs -f"
echo " 状态: docker compose -f $COMPOSE_FILE ps"
