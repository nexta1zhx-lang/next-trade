'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/utils';

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="text-xs text-danger hover:underline"
        >
          断开
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90"
    >
      连接钱包
    </button>
  );
}

function TickerCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ticker', 'binance', 'BTC/USDT'],
    queryFn: () => api.getTicker('binance', 'BTC/USDT'),
    refetchInterval: 10_000,
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">加载中...</div>;
  if (error) return <div className="text-danger text-sm">获取失败</div>;
  if (!data) return null;

  const isUp = data.change24h >= 0;

  return (
    <div className="p-4 rounded-xl border border-border bg-card">
      <div className="text-xs text-muted-foreground mb-1">{data.exchange}</div>
      <div className="text-xl font-bold">{formatPrice(data.price)}</div>
      <div className={`text-sm ${isUp ? 'text-success' : 'text-danger'}`}>
        {isUp ? '+' : ''}{data.change24h.toFixed(2)}%
      </div>
      <div className="mt-2 text-xs text-muted-foreground grid grid-cols-2 gap-1">
        <span>高: {formatPrice(data.high24h)}</span>
        <span>低: {formatPrice(data.low24h)}</span>
        <span>量: {data.volume24h.toFixed(0)}</span>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-bold tracking-tight">nextTrade</h1>
        <WalletButton />
      </header>

      {/* Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TickerCard />
        <TickerCard />
        <TickerCard />
      </div>
    </main>
  );
}
