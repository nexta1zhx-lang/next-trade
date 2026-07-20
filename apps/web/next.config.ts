import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@nexttrade/shared'],
  // API proxy to Hono.js backend
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ];
  },
};

export default nextConfig;
