import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/price-display";
import { MarketChart } from "@/components/market-chart";
import { CandlestickChart } from "@/components/candlestick-chart";
import { StatCard } from "@/components/stat-card";
import { StatusIndicator } from "@/components/status-indicator";
import { Activity, Volume2, TrendingUp, TrendingDown, Clock, BarChart3, Gauge, Wifi, WifiOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useSymbol } from "@/lib/symbol-context";
import { useWebSocket, type WSMessage, type WSConnectionStatus } from "@/hooks/use-websocket";
import { queryClient } from "@/lib/queryClient";
import { useCallback } from "react";
import type { MarketData, MarketStats } from "@shared/schema";

interface IndicatorData {
  timestamp: string;
  ema12?: number;
  ema26?: number;
  rsi14?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
}

interface TradingSignal {
  signal: "BUY" | "SELL" | "HOLD";
  strength: number;
  reasons: string[];
}

interface IndicatorsResponse {
  indicators: IndicatorData[];
  signal: TradingSignal;
  latest: IndicatorData | null;
}

function getConnectionStatusColor(status: WSConnectionStatus): "online" | "offline" | "degraded" {
  switch (status) {
    case "connected":
      return "online";
    case "connecting":
      return "degraded";
    default:
      return "offline";
  }
}

export default function LiveMarket() {
  const { currentSymbol } = useSymbol();
  const symbol = currentSymbol.symbol;

  const handleWSMessage = useCallback((message: WSMessage) => {
    const matchesSymbol = !message.symbol || message.symbol === symbol;
    
    if (message.type === "market_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/market/recent", { symbol }] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/stats", { symbol }] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/indicators", { symbol }] });
    } else if (message.type === "prediction_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/recent", { symbol }] });
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/accuracy", { symbol }] });
    } else if (message.type === "accuracy_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/predictions/accuracy", { symbol }] });
    }
  }, [symbol]);

  const { status: wsStatus, reconnect } = useWebSocket({
    symbol,
    onMessage: handleWSMessage,
  });

  const isConnected = wsStatus === "connected";

  const { data: marketData, isLoading: isLoadingMarket } = useQuery<MarketData[]>({
    queryKey: ["/api/market/recent", { symbol }],
    refetchInterval: isConnected ? false : 30000,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<MarketStats>({
    queryKey: ["/api/market/stats", { symbol }],
    refetchInterval: isConnected ? false : 30000,
  });

  const { data: indicatorsData, isLoading: isLoadingIndicators } = useQuery<IndicatorsResponse>({
    queryKey: ["/api/market/indicators", { symbol }],
    refetchInterval: isConnected ? false : 30000,
  });

  const lastUpdate = marketData?.[marketData.length - 1]?.timestamp;
  const signal = indicatorsData?.signal;
  const latest = indicatorsData?.latest;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Market</h1>
          <p className="text-sm text-muted-foreground">
            Real-time price monitoring and market analysis
          </p>
        </div>
        <div 
          className="flex items-center gap-3 rounded-md bg-card px-3 py-2 border border-card-border cursor-pointer hover-elevate"
          onClick={wsStatus !== "connected" ? reconnect : undefined}
          data-testid="status-websocket"
        >
          {wsStatus === "connected" ? (
            <Wifi className="h-4 w-4 text-profit" />
          ) : wsStatus === "connecting" ? (
            <Wifi className="h-4 w-4 text-yellow-500 animate-pulse" />
          ) : (
            <WifiOff className="h-4 w-4 text-loss" />
          )}
          <StatusIndicator status={getConnectionStatusColor(wsStatus)} size="sm" />
          <div className="flex flex-col">
            <span className="text-xs font-medium">
              {wsStatus === "connected" ? "Live" : wsStatus === "connecting" ? "Connecting..." : "Offline"}
            </span>
            {lastUpdate && wsStatus === "connected" && (
              <span className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(new Date(lastUpdate), { addSuffix: true })}
              </span>
            )}
            {wsStatus !== "connected" && wsStatus !== "connecting" && (
              <span className="text-xs text-muted-foreground">Click to reconnect</span>
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
              symbol={symbol}
              size="lg"
            />
          ) : (
            <div className="text-muted-foreground">No price data available</div>
          )}
        </CardContent>
      </Card>

      <CandlestickChart
        data={marketData || []}
        isLoading={isLoadingMarket}
        title="Candlestick Chart (1H / 1min)"
        height={500}
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
              value={stats.high != null ? `$${stats.high.toFixed(2)}` : "--"}
              icon={TrendingUp}
              valueClassName="text-profit"
              testId="text-day-high"
            />
            <StatCard
              label="Day Low"
              value={stats.low != null ? `$${stats.low.toFixed(2)}` : "--"}
              icon={TrendingDown}
              valueClassName="text-loss"
              testId="text-day-low"
            />
            <StatCard
              label="Volume"
              value={stats.volume != null 
                ? (stats.volume >= 1000000 
                    ? `${(stats.volume / 1000000).toFixed(2)}M` 
                    : `${(stats.volume / 1000).toFixed(1)}K`)
                : "--"
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
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">Technical Indicators</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingIndicators ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : latest ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 pb-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Signal:</span>
                  <Badge
                    variant={signal?.signal === "BUY" ? "default" : signal?.signal === "SELL" ? "destructive" : "secondary"}
                    className={signal?.signal === "BUY" ? "bg-profit text-profit-foreground" : ""}
                    data-testid="badge-signal"
                  >
                    {signal?.signal || "HOLD"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Strength: {signal?.strength || 0}%</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">EMA (12)</span>
                  <span className="font-mono text-sm font-medium" data-testid="text-ema12">
                    {latest.ema12 != null ? `$${latest.ema12.toFixed(2)}` : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">EMA (26)</span>
                  <span className="font-mono text-sm font-medium" data-testid="text-ema26">
                    {latest.ema26 != null ? `$${latest.ema26.toFixed(2)}` : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">RSI (14)</span>
                  <span 
                    className={`font-mono text-sm font-medium ${
                      latest.rsi14 !== undefined
                        ? latest.rsi14 > 70 ? "text-loss" : latest.rsi14 < 30 ? "text-profit" : ""
                        : ""
                    }`}
                    data-testid="text-rsi14"
                  >
                    {latest.rsi14 != null ? latest.rsi14.toFixed(2) : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">MACD Line</span>
                  <span className="font-mono text-sm font-medium" data-testid="text-macd-line">
                    {latest.macdLine != null ? latest.macdLine.toFixed(4) : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">MACD Signal</span>
                  <span className="font-mono text-sm font-medium" data-testid="text-macd-signal">
                    {latest.macdSignal != null ? latest.macdSignal.toFixed(4) : "--"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">MACD Histogram</span>
                  <span 
                    className={`font-mono text-sm font-medium ${
                      latest.macdHistogram !== undefined
                        ? latest.macdHistogram > 0 ? "text-profit" : latest.macdHistogram < 0 ? "text-loss" : ""
                        : ""
                    }`}
                    data-testid="text-macd-histogram"
                  >
                    {latest.macdHistogram != null ? latest.macdHistogram.toFixed(4) : "--"}
                  </span>
                </div>
              </div>
              {signal?.reasons && signal.reasons.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">Analysis: </span>
                  <span className="text-xs">{signal.reasons.join(" • ")}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No indicator data available</div>
          )}
        </CardContent>
      </Card>

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
              <span className="font-mono text-lg font-medium">{symbol}</span>
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
