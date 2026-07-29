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
APK_OUTPUT="$WEB_DIR/android/app/build/outputs/apk/release/app-release-unsigned.apk"

# 服务器配置（可通过参数或环境变量覆盖）
SERVER="${BUILD_SERVER:-aws2}"
# docker-compose.prod.yml 中 Caddy volume: ./apk:/downloads
# 所以上传到 ~/nextTrade/apk/ 即可被 bitcoooin.cn/downloads/ 访问
SERVER_APK_DIR="${SERVER_APK_DIR:-~/nextTrade/apk}"

# 版本号（从 shared 包读取）
VERSION=$(grep "APP_VERSION" packages/shared/src/version.ts | cut -d"'" -f2)
BUILD_NUM=$(grep "APP_BUILD" packages/shared/src/version.ts | cut -d" " -f5)

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
  APK_FILENAME="${APP_NAME_LOWER}-v${VERSION}-b${BUILD_NUM}-dev.apk"  # nexttrade-v0.1.0-b2-dev.apk
else
  API_URL="https://bitcoooin.cn"
  APK_FILENAME="${APP_NAME_LOWER}-v${VERSION}-b${BUILD_NUM}.apk"       # nexttrade-v0.1.0-b2.apk
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
echo "▶ [1/6] 拉取最新代码..."
git pull

# ─── 2. 安装依赖 ──────────────────────────────────────────
echo ""
echo "▶ [2/6] 安装依赖..."
pnpm install

# ─── 3. 构建 shared 包 ─────────────────────────────────────
echo ""
echo "▶ [3/6] 构建 shared 包..."
pnpm --filter @nexttrade/shared run build

# ─── 4. 构建 APK ──────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "▶ [4/6] 构建 Android APK..."

  # 清理 public/downloads 中的旧 APK，防止被 Next.js 打包进静态导出（APK 膨胀根源）
  mkdir -p "$WEB_DIR/public/downloads"
  rm -f "$WEB_DIR/public/downloads"/nexttrade-*.apk
  echo "  → 已清理旧 APK 文件"

  # 预先复制 changelog.json 到 public
  cp "$APK_DIR/changelog.json" "$WEB_DIR/public/downloads/changelog.json"
  # 预先生成 versions.json，供 Next.js 静态构建打包到 out/
  cat > "$WEB_DIR/public/downloads/versions.json" << EOJ
{
  "latest": "${VERSION}",
  "build": ${BUILD_NUM},
  "apkUrl": "/downloads/${APK_FILENAME}",
  "releaseDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updateLog": "查看完整更新日志: https://bitcoooin.cn/about"
}
EOJ

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

  # 4c. Gradle 编译 APK（release 模式，启用代码压缩）
  echo "  → Gradle 编译 (release)..."
  cd android
  ./gradlew assembleRelease --no-daemon
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
  # 同时复制到 web public 目录，供前端动态获取最新版本
  cp "$APK_DIR/versions.json" "$WEB_DIR/public/downloads/versions.json"
  # 同步 changelog.json 供关于页面读取
  cp "$APK_DIR/changelog.json" "$WEB_DIR/public/downloads/changelog.json"
  echo "  → 版本信息已写入: $APK_DIR/versions.json"
else
  echo ""
  echo "▶ [4/6] 跳过构建 (--skip-build)"
fi

# ─── 5. 提交版本变更并推送 ──────────────────────────────
if [ "$SKIP_BUILD" = false ] && [ "$MODE" = "production" ]; then
  echo ""
  echo "▶ [5/6] 提交版本变更并推送..."

  git add packages/shared/src/version.ts
  # 如果还有其它构建时自动生成的文件，可以一并 stage
  git add "$APK_DIR/versions.json" 2>/dev/null || true
  git add "$WEB_DIR/public/downloads/versions.json" 2>/dev/null || true

  if git diff --cached --quiet; then
    echo "  → 无版本变更需要提交"
  else
    git commit -m "chore: bump build to v${VERSION} (build ${BUILD_NUM}) [skip ci]"
    git push
    echo "  → 已提交并推送: v${VERSION} (build ${BUILD_NUM})"
  fi
fi

# ─── 6. 上传到服务器 ──────────────────────────────────────
UPLOAD_DESC="跳过上传 (--no-upload)"
if [ "$UPLOAD" = true ] && [ "$MODE" = "production" ]; then
  echo ""
  echo "▶ [6/6] 上传到服务器..."

  # docker-compose.prod.yml volume: ./apk:/downloads
  # 上传到 ~/nextTrade/apk/ = Caddy 容器内的 /downloads = bitcoooin.cn/downloads/
  ssh -o StrictHostKeyChecking=accept-new "$SERVER" "mkdir -p $SERVER_APK_DIR"

  # 上传整个 apk 目录（APK + versions.json + changelog.json）
  rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" \
    "$APK_DIR/" \
    "$SERVER:$SERVER_APK_DIR/"

  DOWNLOAD_URL="https://bitcoooin.cn/downloads/$APK_FILENAME"
  echo ""
  echo "  ✓ 已上传: $SERVER:$SERVER_APK_DIR/$APK_FILENAME"
  echo "  ✓ 下载地址: $DOWNLOAD_URL"
elif [ "$UPLOAD" = true ] && [ "$MODE" = "development" ]; then
  echo ""
  echo "▶ [6/6] 上传开发版到服务器..."

  ssh -o StrictHostKeyChecking=accept-new "$SERVER" "mkdir -p $SERVER_APK_DIR"
  rsync -avz --progress -e "ssh -o StrictHostKeyChecking=accept-new" \
    "$APK_DIR/$APK_FILENAME" \
    "$SERVER:$SERVER_APK_DIR/"

  echo ""
  echo "  ✓ 开发版已上传: $SERVER:$SERVER_APK_DIR/$APK_FILENAME"
elif [ "$MODE" = "production" ]; then
  echo ""
  echo "▶ [6/6] $UPLOAD_DESC"
  echo "  APK 位置: $APK_DIR/$APK_FILENAME"
  echo "  手动同步: rsync -avz $APK_DIR/ $SERVER:$SERVER_APK_DIR/"
fi

echo ""
echo "============================================"
echo " ✅ 构建完成"
echo "============================================"
echo ""
echo "  版本: v${VERSION} (build ${BUILD_NUM})"
echo "  APK:  $APK_DIR/$APK_FILENAME"
echo "  下载: https://bitcoooin.cn/downloads/$APK_FILENAME"

# ─── 自动打 git tag ─────────────────────────────────────
TAG_NAME="v${VERSION}-b${BUILD_NUM}"
if ! git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  git tag "$TAG_NAME"
  git push origin "$TAG_NAME" 2>/dev/null && echo "  → 已推送 tag: $TAG_NAME" || echo "  → 已创建本地 tag: $TAG_NAME（推送失败，请手动推送）"
fi
