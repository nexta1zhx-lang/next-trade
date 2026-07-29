# ─── 构建阶段 ───
FROM node:22-alpine AS builder

# 限制 Node.js 堆内存，防止小服务器 OOM
ENV NODE_OPTIONS=--max-old-space-size=2048

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 复制 monorepo 配置文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./

# 复制 workspace 包
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/web/tsconfig.json apps/web/
COPY apps/web/next.config.ts apps/web/
COPY apps/web/postcss.config.mjs apps/web/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 构建时注入 API URL（Docker Compose 传入，默认 localhost）
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# 复制源码
COPY packages/shared/src packages/shared/src
COPY apps/web/src apps/web/src
# 确保 public 目录存在（git 不追踪空目录，但 Docker COPY 需要源路径存在）
RUN mkdir -p apps/web/public
COPY apps/web/public apps/web/public

# 构建 shared 包
RUN pnpm --filter @nexttrade/shared run build

# 静态导出模式，生成 out/ 目录
ENV STATIC_EXPORT=true
RUN pnpm --filter @nexttrade/web run build

# ─── 生产阶段（静态文件服务，无需 Node.js/Python） ───
FROM alpine:3.19

RUN apk add --no-cache busybox-extras

# 复制静态导出产物（trailingSlash 确保目录结构）
COPY --from=builder /app/apps/web/out /var/www/html

EXPOSE 3000

# busybox httpd 轻量级 HTTP 服务器
CMD ["busybox", "httpd", "-f", "-v", "-p", "3000", "-h", "/var/www/html"]
