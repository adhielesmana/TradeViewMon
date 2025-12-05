import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarketChart } from "@/components/market-chart";
import { OHLCVTable } from "@/components/ohlcv-table";
import { TimeFilter } from "@/components/time-filter";
import { StatCard } from "@/components/stat-card";
import { ExportDropdown } from "@/components/export-dropdown";
import { TrendingUp, TrendingDown, BarChart2, Calendar } from "lucide-react";
import { useSymbol } from "@/lib/symbol-context";
import { useWebSocket, type WSMessage } from "@/hooks/use-websocket";
import { queryClient } from "@/lib/queryClient";
import type { MarketData } from "@shared/schema";

export default function Historical() {
  const { currentSymbol } = useSymbol();
  const symbol = currentSymbol.symbol;
  const [timeFilter, setTimeFilter] = useState("1M");

  const handleWSMessage = useCallback((message: WSMessage) => {
    const matchesSymbol = !message.symbol || message.symbol === symbol;
    
    if (message.type === "market_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/market/historical", { symbol, period: timeFilter }] });
    }
  }, [symbol, timeFilter]);

  useWebSocket({
    symbol,
    onMessage: handleWSMessage,
  });

  const { data: historicalData, isLoading } = useQuery<MarketData[]>({
    queryKey: ["/api/market/historical", { symbol, period: timeFilter }],
    refetchInterval: 60000,
  });

  const stats = historicalData && historicalData.length > 0 ? {
    startPrice: historicalData[0].open,
    endPrice: historicalData[historicalData.length - 1].close,
    highestPrice: Math.max(...historicalData.map(d => d.high)),
    lowestPrice: Math.min(...historicalData.map(d => d.low)),
    totalVolume: historicalData.reduce((sum, d) => sum + d.volume, 0),
    change: historicalData[historicalData.length - 1].close - historicalData[0].open,
    changePercent: ((historicalData[historicalData.length - 1].close - historicalData[0].open) / historicalData[0].open) * 100,
  } : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Historical Data</h1>
          <p className="text-sm text-muted-foreground">
            Explore past market performance and trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TimeFilter value={timeFilter} onChange={setTimeFilter} />
          <ExportDropdown 
            endpoint="/api/export/market"
            filename={`${symbol}_market_data_${timeFilter}`}
            params={{ symbol, period: timeFilter }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Period High"
          value={stats ? `$${stats.highestPrice.toFixed(2)}` : "--"}
          icon={TrendingUp}
          valueClassName="text-profit"
          testId="text-period-high"
        />
        <StatCard
          label="Period Low"
          value={stats ? `$${stats.lowestPrice.toFixed(2)}` : "--"}
          icon={TrendingDown}
          valueClassName="text-loss"
          testId="text-period-low"
        />
        <StatCard
          label="Period Change"
          value={stats ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(2)}` : "--"}
          subValue={stats ? `${stats.changePercent >= 0 ? '+' : ''}${stats.changePercent.toFixed(2)}%` : undefined}
          trend={stats ? (stats.change >= 0 ? "up" : "down") : undefined}
          icon={BarChart2}
          valueClassName={stats && stats.change >= 0 ? "text-profit" : "text-loss"}
          testId="text-period-change"
        />
        <StatCard
          label="Data Points"
          value={historicalData?.length || 0}
          icon={Calendar}
          testId="text-data-points-historical"
        />
      </div>

      <MarketChart
        data={historicalData || []}
        isLoading={isLoading}
        title={`Price History (${timeFilter})`}
        height={450}
      />

      <OHLCVTable
        data={historicalData || []}
        isLoading={isLoading}
        maxHeight={500}
      />
    </div>
  );
}
