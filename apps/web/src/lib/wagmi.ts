'use client';

import { http, createConfig } from 'wagmi';
import { mainnet, bsc } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [mainnet, bsc],
  connectors: [
    injected(),
    walletConnect({ projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '' }),
  ],
  transports: {
    [mainnet.id]: http(),
    [bsc.id]: http(),
  },
});
