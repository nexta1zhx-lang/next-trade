#!/usr/bin/env bash
# ─── nextTrade APK 自动构建 & 上传脚本 ─────────────────────────
# 用法:
#   ./scripts/build-apk.sh                    # 生产: 构建 APK + 上传到服务器
#   ./scripts/build-apk.sh --dev              # 开发: 构建 APK (连本地 API)，不上传
#   ./scripts/build-apk.sh --no-upload        # 只构建，不上传
#   ./scripts/build-apk.sh --server user@host # 指定服务器地址
#   ./scripts/build-apk.sh --skip-build       # 只上传已有的 APK
# ────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

# ─── 配置 ────────────────────────────────────────────────────
APP_NAME="nextTrade"
WEB_DIR="apps/web"
APK_DIR="apk"
APK_OUTPUT="$WEB_DIR/android/app/build/outputs/apk/debug/app-debug.apk"

# 服务器配置（可通过参数或环境变量覆盖）
SERVER="${BUILD_SERVER:-aws2}"
SERVER_APK_DIR="${SERVER_APK_DIR:-~/nextTrade/apk}"

# 版本号（从 shared 包读取）
VERSION=$(grep "APP_VERSION" packages/shared/src/version.ts | cut -d"'" -f2)
BUILD_NUM=$(grep "APP_BUILD" packages/shared/src/version.ts | cut -d" " -f3)

# ─── 构建号自动递增 ────────────────────────────────────────
BUILD_NUM=$((BUILD_NUM + 1))
sed -i '' "s/^export const APP_BUILD = [0-9]*/export const APP_BUILD = $BUILD_NUM/" packages/shared/src/version.ts
echo "  → 构建号: v${VERSION} (build ${BUILD_NUM})"

MODE="production"  # production | development
UPLOAD=true
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --dev)       MODE="development" ;;
    --no-upload) UPLOAD=false ;;
    --skip-build) SKIP_BUILD=true ;;
    --server=*) SERVER="${arg#*=}" ;;
  esac
done

# 根据模式确定 API 地址和文件名
APP_NAME_LOWER=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]')
if [ "$MODE" = "development" ]; then
  API_URL="http://192.168.31.130:3001"
  APK_FILENAME="${APP_NAME_LOWER}-v${VERSION}-dev.apk"  # nexttrade-v0.1.0-dev.apk
else
  API_URL="https://bitcoooin.cn"
  APK_FILENAME="${APP_NAME_LOWER}-v${VERSION}.apk"       # nexttrade-v0.1.0.apk
fi

echo "============================================"
echo " nextTrade APK 构建脚本"
echo " 版本: v${VERSION} (build ${BUILD_NUM})"
echo " 模式: $MODE"
echo " 时间: $(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

# ─── 环境检查 ──────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  command -v java >/dev/null 2>&1 || { echo "❌ 需要 JDK 21+"; exit 1; }
  command -v node >/dev/null 2>&1 || { echo "❌ 需要 Node.js"; exit 1; }

  # 检查 Android SDK
  ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if [ ! -d "$ANDROID_HOME" ]; then
    echo "⚠ 未找到 Android SDK (ANDROID_HOME=$ANDROID_HOME)"
    echo "   请设置正确的 ANDROID_HOME 环境变量"
    exit 1
  fi
  export ANDROID_HOME
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21"

  echo ""
  echo "  ANDROID_HOME: $ANDROID_HOME"
  echo "  JAVA_HOME:    $JAVA_HOME"
fi

# ─── 1. 拉取最新代码 ──────────────────────────────────────
echo ""
echo "▶ [1/5] 拉取最新代码..."
git pull

# ─── 2. 安装依赖 ──────────────────────────────────────────
echo ""
echo "▶ [2/5] 安装依赖..."
pnpm install

# ─── 3. 构建 shared 包 ─────────────────────────────────────
echo ""
echo "▶ [3/5] 构建 shared 包..."
pnpm --filter @nexttrade/shared run build

# ─── 4. 构建 APK ──────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "▶ [4/5] 构建 Android APK..."

  # 进入到 web 目录执行构建
  cd "$WEB_DIR"

  # 设置 Capacitor 构建环境变量
  export BUILD_FOR_CAPACITOR=true
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$API_URL}"

  echo "  模式: $MODE"
  echo "  API URL: $NEXT_PUBLIC_API_URL"

  # 4a. Next.js 静态导出
  echo "  → Next.js 静态构建..."
  pnpm run build

  # 4b. Capacitor 同步
  echo "  → Capacitor 同步..."
  npx cap sync

  # 4c. Gradle 编译 APK
  echo "  → Gradle 编译..."
  cd android
  ./gradlew assembleDebug --no-daemon
  cd ..

  cd ../..  # 回到项目根目录

  # 检查 APK 是否生成
  if [ ! -f "$APK_OUTPUT" ]; then
    echo "❌ APK 构建失败：未找到输出文件 $APK_OUTPUT"
    exit 1
  fi

  # 4d. 重命名并复制到 apk 目录
  echo ""
  echo "  → APK 构建成功！"
  ls -lh "$APK_OUTPUT"

  mkdir -p "$APK_DIR"
  cp "$APK_OUTPUT" "$APK_DIR/$APK_FILENAME"
  echo "  → 已复制到: $APK_DIR/$APK_FILENAME"

  # 复制到 public/downloads/ 供本地开发环境访问
  mkdir -p "$WEB_DIR/public/downloads"
  cp "$APK_OUTPUT" "$WEB_DIR/public/downloads/$APK_FILENAME"
  echo "  → 已复制到: $WEB_DIR/public/downloads/$APK_FILENAME"

  # 生成版本信息 JSON
  cat > "$APK_DIR/versions.json" << EOF
{
  "latest": "${VERSION}",
  "build": ${BUILD_NUM},
  "apkUrl": "/downloads/${APK_FILENAME}",
  "releaseDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updateLog": "查看完整更新日志: https://bitcoooin.cn/about"
}
EOF
  echo "  → 版本信息已写入: $APK_DIR/versions.json"
else
  echo ""
  echo "▶ [4/5] 跳过构建 (--skip-build)"
fi

# ─── 5. 上传到服务器 ──────────────────────────────────────
UPLOAD_DESC="跳过上传 (--no-upload)"
if [ "$UPLOAD" = true ] || [ "$MODE" = "development" ]; then
  echo ""
  echo "▶ [5/5] 上传 APK 到服务器..."

  # 确保服务器目录存在（自动接受新主机密钥）
  ssh -o StrictHostKeyChecking=accept-new "$SERVER" "mkdir -p $SERVER_APK_DIR"

  if [ "$MODE" = "development" ]; then
    # 开发模式：只上传 APK 文件，不覆盖 versions.json
    rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" "$APK_DIR/$APK_FILENAME" "$SERVER:$SERVER_APK_DIR/"
    DOWNLOAD_URL="https://bitcoooin.cn/downloads/$APK_FILENAME"
    UPLOAD_DESC="开发版已上传"
  else
    # 生产模式：上传整个目录（含 versions.json）
    rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" "$APK_DIR/" "$SERVER:$SERVER_APK_DIR/"
    DOWNLOAD_URL="https://bitcoooin.cn/downloads/$APK_FILENAME"
    UPLOAD_DESC="生产版已上传"
  fi

  echo ""
  echo "  ✓ $UPLOAD_DESC: $SERVER:$SERVER_APK_DIR/$APK_FILENAME"
  echo "  ✓ 下载地址: $DOWNLOAD_URL"

  # 可选：触发远程部署（使 Caddy 立即生效）
  # ssh -o StrictHostKeyChecking=accept-new "$SERVER" "cd ~/nextTrade && docker compose -f docker-compose.prod.yml restart caddy"
elif [ "$MODE" = "development" ]; then
  # 不会走到这里，上面已处理
  :
else
  echo ""
  echo "▶ [5/5] $UPLOAD_DESC"
  echo "  APK 位置: $APK_DIR/$APK_FILENAME"
  echo "  手动上传: rsync -avz $APK_DIR/ $SERVER:$SERVER_APK_DIR/"
fi

echo ""
echo "============================================"
echo " 完成 ✓"
echo "============================================"
echo ""
echo "  APK: $APK_DIR/$APK_FILENAME"
echo "  下载: https://bitcoooin.cn/downloads/$APK_FILENAME"
