import type {NextConfig} from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@nexttrade/shared'],
  allowedDevOrigins: ['192.168.31.130'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*'
      },
      // WebSocket 代理（局域网调试用）
      {
        source: '/ws',
        destination: 'http://localhost:3001/ws'
      }
    ]
  }
}

export default nextConfig
