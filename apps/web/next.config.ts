import type {NextConfig} from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

// 判断是否为 Capacitor 构建（通过环境变量触发）
const isCapacitor = process.env.BUILD_FOR_CAPACITOR === 'true'

const isStatic = process.env.STATIC_EXPORT === 'true' || isCapacitor

const nextConfig: NextConfig = {
  transpilePackages: ['@nexttrade/shared'],
  allowedDevOrigins: ['192.168.31.130'],

  // ─── 静态导出模式（Docker 生产部署 & Capacitor 构建）───
  ...(isStatic
    ? {
        output: 'export' as const,
        trailingSlash: true,
        images: {unoptimized: true}
      }
    : {
        httpAgentOptions: {
          keepAlive: false
        },
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${API_URL}/api/:path*`
            },
            {
              source: '/ws/:path*',
              destination: `${API_URL}/ws/:path*`
            }
          ]
        }
      })
}

export default nextConfig
