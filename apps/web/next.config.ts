import type {NextConfig} from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const nextConfig: NextConfig = {
  transpilePackages: ['@nexttrade/shared'],
  allowedDevOrigins: ['192.168.31.130'],
  // 禁用 keepAlive 防止连接复用导致的 ECONNRESET
  httpAgentOptions: {
    keepAlive: false,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`
      },
      // WebSocket 代理
      {
        source: '/ws/:path*',
        destination: `${API_URL}/ws/:path*`
      }
    ]
  }
}

export default nextConfig
