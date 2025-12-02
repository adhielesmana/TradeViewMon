import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceDisplay } from "@/components/price-display";
import { MarketChart } from "@/components/market-chart";
import { StatCard } from "@/components/stat-card";
import { StatusIndicator } from "@/components/status-indicator";
import { Activity, Volume2, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { MarketData, MarketStats } from "@shared/schema";

export default function LiveMarket() {
  const { data: marketData, isLoading: isLoadingMarket } = useQuery<MarketData[]>({
    queryKey: ["/api/market/recent"],
    refetchInterval: 30000,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<MarketStats>({
    queryKey: ["/api/market/stats"],
    refetchInterval: 30000,
  });

  const lastUpdate = marketData?.[marketData.length - 1]?.timestamp;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Market</h1>
          <p className="text-sm text-muted-foreground">
            Real-time price monitoring and market analysis
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md bg-card px-3 py-2 border border-card-border">
          <StatusIndicator status="online" size="sm" />
          <div className="flex flex-col">
            <span className="text-xs font-medium">Live Data</span>
            {lastUpdate && (
              <span className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(new Date(lastUpdate), { addSuffix: true })}
              </span>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Current Price</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingStats ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-6 w-24" />
            </div>
          ) : stats ? (
            <PriceDisplay
              price={stats.currentPrice}
              change={stats.change}
              changePercent={stats.changePercent}
              symbol="AAPL"
              size="lg"
            />
          ) : (
            <div className="text-muted-foreground">No price data available</div>
          )}
        </CardContent>
      </Card>

      <MarketChart
        data={marketData || []}
        isLoading={isLoadingMarket}
        title="1-Minute Price Chart"
        height={350}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoadingStats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : stats ? (
          <>
            <StatCard
              label="Day High"
              value={`$${stats.high.toFixed(2)}`}
              icon={TrendingUp}
              valueClassName="text-profit"
              testId="text-day-high"
            />
            <StatCard
              label="Day Low"
              value={`$${stats.low.toFixed(2)}`}
              icon={TrendingDown}
              valueClassName="text-loss"
              testId="text-day-low"
            />
            <StatCard
              label="Volume"
              value={stats.volume >= 1000000 
                ? `${(stats.volume / 1000000).toFixed(2)}M` 
                : `${(stats.volume / 1000).toFixed(1)}K`
              }
              icon={Volume2}
              testId="text-volume"
            />
            <StatCard
              label="Last Update"
              value={stats.lastUpdate 
                ? formatDistanceToNow(new Date(stats.lastUpdate), { addSuffix: true })
                : "N/A"
              }
              icon={Clock}
              testId="text-last-update"
            />
          </>
        ) : (
          <div className="col-span-4 text-center text-muted-foreground">
            No statistics available
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">Market Activity</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Open</span>
              <span className="font-mono text-lg font-medium" data-testid="text-open-price">
                {marketData?.[0]?.open ? `$${marketData[0].open.toFixed(2)}` : "--"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Interval</span>
              <span className="text-lg font-medium">1 minute</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Symbol</span>
              <span className="text-lg font-medium">AAPL</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Data Points</span>
              <span className="font-mono text-lg font-medium" data-testid="text-data-points">
                {marketData?.length || 0}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
