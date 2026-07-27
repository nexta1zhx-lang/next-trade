import type {Metadata, Viewport} from 'next'
import {Providers} from '@/lib/providers'
import {AppShell} from '@/components/layout/AppShell'
import {DebugLogger} from '@/components/DebugLogger'
import './globals.css'

export const metadata: Metadata = {
  title: 'nextTrade',
  description: 'AI-assisted quantitative trading platform',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'NextTrade'
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a'
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <Providers>
          <DebugLogger />
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
