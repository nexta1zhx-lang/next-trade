#!/usr/bin/env bash
# ─── nextTrade 更新日志自动生成脚本 ─────────────────────────
# 用法:
#   ./scripts/gen-changelog.sh                       # 交互式输入新版本号
#   ./scripts/gen-changelog.sh 0.2.0                 # 直接指定版本号
#   ./scripts/gen-changelog.sh --auto 0.2.0 2        # 自动模式（for build-apk.sh 集成）
# ────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

CHANGELOG_FILE="apk/changelog.json"
AUTO_MODE=false

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --auto) AUTO_MODE=true ;;
  esac
done

# 位置参数: 第一个非 -- 开头的参数为版本号
VERSION_INPUT=""
for arg in "$@"; do
  if [[ "$arg" != --* ]] && [ -z "$VERSION_INPUT" ]; then
    VERSION_INPUT="$arg"
  fi
done

# ─── 读取最新版本信息 ────────────────────────────────────
LAST_VERSION=$(python3 -c "
import json
with open('$CHANGELOG_FILE') as f:
    data = json.load(f)
print(data[-1]['version'])
" 2>/dev/null || echo "")

LAST_DATE=$(python3 -c "
import json
with open('$CHANGELOG_FILE') as f:
    data = json.load(f)
print(data[-1]['date'])
" 2>/dev/null || echo "")

LAST_BUILD=$(python3 -c "
import json
with open('$CHANGELOG_FILE') as f:
    data = json.load(f)
print(data[-1]['build'])
" 2>/dev/null || echo "0")

echo "============================================"
echo " nextTrade Changelog Generator"
echo " Last: v${LAST_VERSION:-none} (build ${LAST_BUILD:-0}) / ${LAST_DATE:-none}"
echo "============================================"

# ─── 确定新版本号 ───────────────────────────────────────
if [ -z "$VERSION_INPUT" ]; then
  # 自动建议下一版本号（递增最后一位）
  if [ -n "$LAST_VERSION" ]; then
    IFS='.' read -r MAJOR MINOR PATCH <<< "$LAST_VERSION"
    SUGGEST="${MAJOR}.${MINOR}.$((PATCH + 1))"
  else
    SUGGEST="0.1.0"
  fi
  echo ""
  echo "请输入新版本号 (默认: ${SUGGEST}):"
  read -r VERSION_INPUT
  VERSION_INPUT="${VERSION_INPUT:-$SUGGEST}"
fi

# ─── 从 git 日志生成更新条目 ─────────────────────────────
echo ""
echo "▶ 分析 git 提交记录..."

# 确定 since 参数（使用最近的 tag，没有则回退到日期）
SINCE_REF=""
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -n "$LAST_TAG" ]; then
  SINCE_REF="$LAST_TAG"
  echo "  → 参考 tag: $LAST_TAG"
elif [ -n "$LAST_DATE" ]; then
  # --since 不包含当天，提前一天确保覆盖
  PREV_DATE=$(date -j -v-1d -f "%Y-%m-%d" "$LAST_DATE" "+%Y-%m-%d" 2>/dev/null || echo "$LAST_DATE")
  SINCE_REF="--since=${PREV_DATE}"
fi

# 获取提交记录，按类型归类
ITEMS=()

# 提取 feat 类型提交
while IFS= read -r msg; do
  [ -z "$msg" ] && continue
  # 去掉前缀如 feat(xxx): 或 feat: 
  clean=$(echo "$msg" | sed -E 's/^(feat|feature)(\([^)]*\))?:\s*//i')
  ITEMS+=("✨ $clean")
done < <(git log ${SINCE_REF:+$SINCE_REF} --oneline --no-decorate --grep="^feat" 2>/dev/null | cut -d' ' -f2- || true)

# 提取 fix 类型提交
while IFS= read -r msg; do
  [ -z "$msg" ] && continue
  clean=$(echo "$msg" | sed -E 's/^fix(\([^)]*\))?:\s*//i')
  ITEMS+=("🐛 $clean")
done < <(git log ${SINCE_REF:+$SINCE_REF} --oneline --no-decorate --grep="^fix" 2>/dev/null | cut -d' ' -f2- || true)

# 提取其他有意义的提交（refactor, perf, chore 等）
while IFS= read -r msg; do
  [ -z "$msg" ] && continue
  clean=$(echo "$msg" | sed -E 's/^(refactor|perf|improve)(\([^)]*\))?:\s*//i')
  ITEMS+=("🔧 $clean")
done < <(git log ${SINCE_REF:+$SINCE_REF} --oneline --no-decorate --grep="^refactor\|^perf\|^improve" 2>/dev/null | cut -d' ' -f2- || true)

# 如果没有找到结构化提交，回退到全部提交
if [ ${#ITEMS[@]} -eq 0 ]; then
  echo "  ⚠ 未找到 conventional commit，使用全部提交..."
  while IFS= read -r msg; do
    [ -z "$msg" ] && continue
    ITEMS+=("$msg")
  done < <(git log ${SINCE_REF:+$SINCE_REF} --oneline --no-decorate 2>/dev/null | cut -d' ' -f2- || true)
fi

if [ ${#ITEMS[@]} -eq 0 ]; then
  echo "  ⚠ 没有新的提交记录"
  ITEMS+=("小修复和改进")
fi

# ─── 显示预览 ────────────────────────────────────────────
echo ""
echo "▶ 待添加的更新条目:"
for item in "${ITEMS[@]}"; do
  echo "  • $item"
done

# ─── 确认（自动模式跳过） ──────────────────────────────
if [ "$AUTO_MODE" = false ]; then
  echo ""
  echo "是否添加到 changelog.json？(Y/n): "
  read -r CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  if [[ "$CONFIRM" != "Y" && "$CONFIRM" != "y" ]]; then
    echo "已取消"
    exit 0
  fi
fi

# ─── 构建 JSON 条目并写入 ────────────────────────────────
NEW_BUILD=$((LAST_BUILD + 1))
TODAY=$(date +%Y-%m-%d)

# 将 items 写入临时文件，由 python3 读取（避免 shell 拼接 JSON 转义问题）
ITEMS_TMP=$(mktemp)
printf '%s\n' "${ITEMS[@]}" > "$ITEMS_TMP"

python3 -c "
import json, sys

with open('$CHANGELOG_FILE') as f:
    data = json.load(f)

# 从临时文件读取 items
with open('$ITEMS_TMP') as f:
    items = [line.rstrip('\n') for line in f if line.strip()]

# 自动模式下如果版本已存在，只更新 build/date，保留已有 items
existing_idx = next((i for i, e in enumerate(data) if e['version'] == '$VERSION_INPUT'), -1)
if existing_idx >= 0 and $AUTO_MODE:
    data[existing_idx]['build'] = $NEW_BUILD
    data[existing_idx]['date'] = '$TODAY'
else:
    data.append({
        'version': '$VERSION_INPUT',
        'build': $NEW_BUILD,
        'date': '$TODAY',
        'items': items
    })

with open('$CHANGELOG_FILE', 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write('\n')
"

rm -f "$ITEMS_TMP"

echo ""
echo "  ✓ 已写入 $CHANGELOG_FILE"
echo ""

# ─── 生成 CHANGELOG.md ──────────────────────────────────
echo "▶ 同步生成 CHANGELOG.md..."
python3 -c "
import json

with open('$CHANGELOG_FILE') as f:
    data = json.load(f)

lines = ['# nextTrade 更新日志\n']
for entry in reversed(data):
    lines.append(f\"\"\"
## [{entry['version']}] - {entry['date']}

\"\"\")
    for item in entry['items']:
        lines.append(f\"- {item}\n\")

with open('CHANGELOG.md', 'w') as f:
    f.writelines(lines)
"

echo "  ✓ 已写入 CHANGELOG.md"
echo ""
echo "============================================"
echo " 完成 ✅"
echo "============================================"
echo ""
echo "  版本: v${VERSION_INPUT} (build ${NEW_BUILD})"
echo "  条目: ${#ITEMS[@]} 条"
