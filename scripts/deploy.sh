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
# 注意: 此脚本在服务器上运行，仅用于 Docker 服务部署。
#       APK 构建请在本地 macOS 执行: ./scripts/build-apk.sh
# ─────────────────────────────────────────────────────────

cd "$(dirname "$0")/.."

# ─── 智能路由 ─────────────────────────────────────────
# 识别是否在目标部署服务器 (3.115.2.104) 上运行，
# 如果不是则自动通过 SSH aws2 远程执行（带参数透传）
# ─────────────────────────────────────────────────────
if ! hostname -I 2>/dev/null | grep -qE '3\.115\.2\.104|172\.26\.8\.124'; then
  echo "◉ 检测到非服务器环境，通过 SSH aws2 远程部署..."
  echo "  参数: $*"
  # 使用 printf '%q' 安全序列化参数（支持空格等特殊字符）
  # 尝试几个常见路径找到项目目录
  for REMOTE_DIR in "/home/ubuntu/nextTrade" "~/nextTrade" "/home/ec2-user/nextTrade"; do
    if ssh aws2 "test -d $REMOTE_DIR" 2>/dev/null; then
      ssh aws2 "cd $REMOTE_DIR && bash scripts/deploy.sh $(printf '%q ' "$@")"
      exit $?
    fi
  done
  echo "✗ 错误: 无法在服务器上找到 nextTrade 项目目录"
  echo "  请修改脚本中的 REMOTE_DIR 路径，或手动 SSH 到服务器执行"
  exit 1
fi

COMPOSE_FILE="docker-compose.prod.yml"
SERVICE=""                # 可选: api / web
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

# ─── 0. 检查 swap（小服务器构建需要） ───
SWAP_SIZE=$(free -m 2>/dev/null | awk '/Swap:/{print $2}') || SWAP_SIZE=0
if [ "$SWAP_SIZE" -lt 1024 ] 2>/dev/null; then
  echo ""
  echo "▶ 创建 swap（当前 ${SWAP_SIZE:-0}MB，目标 2GB）..."
  if command -v fallocate &>/dev/null; then
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null
  else
    sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null
  fi
  sudo chmod 600 /swapfile 2>/dev/null
  sudo mkswap /swapfile > /dev/null 2>&1
  sudo swapon /swapfile > /dev/null 2>&1
  echo "  ✓ swap 已启用"
else
  echo "  ✓ swap 充足（当前 ${SWAP_SIZE}MB）"
fi

# ─── 1. 拉取最新代码 ───
echo ""
echo "▶ 丢弃本地改动，拉取最新代码..."
git reset --hard HEAD
git clean -fd
git pull

# ─── 2. 构建并启动（先 build 再 up，避免 --build 同时编译+启动） ───
echo ""
if [ -n "$SERVICE" ]; then
  echo "▶ 单独构建 [$SERVICE]..."
  docker compose -f "$COMPOSE_FILE" build "$SERVICE"
  docker compose -f "$COMPOSE_FILE" up -d "$SERVICE"
else
  echo "▶ 全量构建所有服务（串行：先 api 后 web，避免内存爆满）..."
  docker compose -f "$COMPOSE_FILE" build api
  docker compose -f "$COMPOSE_FILE" build web
  docker compose -f "$COMPOSE_FILE" up -d
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
