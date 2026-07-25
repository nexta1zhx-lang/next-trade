import type {NextConfig} from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const nextConfig: NextConfig = {
  transpilePackages: ['@nexttrade/shared'],
  allowedDevOrigins: ['192.168.31.130'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`
      },
      // WebSocket 代理
      {
        source: '/ws',
        destination: `${API_URL}/ws`
      }
    ]
  }
}

export default nextConfig
