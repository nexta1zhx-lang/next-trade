import type {Metadata} from 'next'
import {Providers} from '@/lib/providers'
import {AppShell} from '@/components/layout/AppShell'
import './globals.css'

export const metadata: Metadata = {
  title: 'nextTrade',
  description: 'AI-assisted quantitative trading platform'
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
