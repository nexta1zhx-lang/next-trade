'use client'

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState, type ReactNode} from 'react'
import GlobalToast from '@/components/GlobalToast'

export function Providers({children}: {children: ReactNode}) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <GlobalToast />
    </QueryClientProvider>
  )
}
