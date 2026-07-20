# ─── 构建阶段 ───
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 复制 monorepo 配置文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./

# 复制 workspace 包
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY apps/api/package.json apps/api/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/

# 构建 shared 包
RUN pnpm --filter @nexttrade/shared run build

# 构建 api 包
RUN pnpm --filter @nexttrade/api run build

# ─── 生产阶段 ───
FROM node:22-alpine

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 复制 monorepo 配置文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# 复制 workspace 包（仅生产依赖）
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# 安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# 复制构建产物
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
