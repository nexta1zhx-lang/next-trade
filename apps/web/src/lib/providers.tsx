'use client'

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState, type ReactNode} from 'react'
import GlobalToast from '@/components/GlobalToast'
import {DeviceTypeProvider} from '@/hooks/useDeviceType'

export function Providers({children}: {children: ReactNode}) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <DeviceTypeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <GlobalToast />
      </QueryClientProvider>
    </DeviceTypeProvider>
  )
}
