import type {NextConfig} from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// 判断是否为 Capacitor 构建（通过环境变量触发）
const isCapacitor = process.env.BUILD_FOR_CAPACITOR === 'true'

const nextConfig: NextConfig = {
  transpilePackages: ['@nexttrade/shared'],
  allowedDevOrigins: ['192.168.31.130'],

  // ─── Capacitor 构建：静态导出 ───
  ...(isCapacitor
    ? {
        output: 'export' as const,
        // 静态导出不需要这些
        images: {unoptimized: true},
      }
    : {
        // 禁用 keepAlive 防止连接复用导致的 ECONNRESET
        httpAgentOptions: {
          keepAlive: false,
        },
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${API_URL}/api/:path*`,
            },
            // WebSocket 代理
            {
              source: '/ws/:path*',
              destination: `${API_URL}/ws/:path*`,
            },
          ]
        },
      }),
}

export default nextConfig
