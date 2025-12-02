import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketData } from "@shared/schema";
import { format } from "date-fns";

interface CandlestickChartProps {
  data: MarketData[];
  isLoading?: boolean;
  title?: string;
  height?: number;
  className?: string;
}

interface CandleData {
  time: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isUp: boolean;
  bodyLow: number;
  bodyHigh: number;
  wickTop: number;
  wickBottom: number;
}

export function CandlestickChart({
  data,
  isLoading = false,
  title = "Candlestick Chart",
  height = 350,
  className,
}: CandlestickChartProps) {
  const chartData = useMemo<CandleData[]>(() => {
    return data.map((item) => {
      const isUp = item.close >= item.open;
      return {
        time: format(new Date(item.timestamp), "HH:mm"),
        timestamp: new Date(item.timestamp),
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        isUp,
        bodyLow: Math.min(item.open, item.close),
        bodyHigh: Math.max(item.open, item.close),
        wickTop: item.high,
        wickBottom: item.low,
      };
    });
  }, [data]);

  const { minPrice, maxPrice, avgPrice } = useMemo(() => {
    if (data.length === 0) return { minPrice: 0, maxPrice: 0, avgPrice: 0 };
    const lows = data.map((d) => d.low);
    const highs = data.map((d) => d.high);
    const closes = data.map((d) => d.close);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    const padding = (max - min) * 0.1;
    return { 
      minPrice: min - padding, 
      maxPrice: max + padding,
      avgPrice: avg 
    };
  }, [data]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="w-full" style={{ height }} />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div 
            className="flex items-center justify-center text-muted-foreground"
            style={{ height }}
          >
            No market data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="hsl(var(--border))" 
              opacity={0.4}
              vertical={false}
            />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              dy={10}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minPrice, maxPrice]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => value >= 1000 ? `$${(value/1000).toFixed(1)}k` : `$${value.toFixed(2)}`}
              dx={-5}
              width={70}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload as CandleData;
                const change = ((d.close - d.open) / d.open * 100).toFixed(2);
                const isPositive = d.close >= d.open;
                return (
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-md">
                    <div className="font-medium mb-2">{format(d.timestamp, "MMM dd, HH:mm")}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-mono">${d.open.toFixed(2)}</span>
                      <span className="text-muted-foreground">High:</span>
                      <span className="font-mono text-profit">${d.high.toFixed(2)}</span>
                      <span className="text-muted-foreground">Low:</span>
                      <span className="font-mono text-loss">${d.low.toFixed(2)}</span>
                      <span className="text-muted-foreground">Close:</span>
                      <span className="font-mono">${d.close.toFixed(2)}</span>
                      <span className="text-muted-foreground">Change:</span>
                      <span className={`font-mono ${isPositive ? "text-profit" : "text-loss"}`}>
                        {isPositive ? "+" : ""}{change}%
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine 
              y={avgPrice} 
              stroke="hsl(var(--muted-foreground))" 
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <Bar 
              dataKey="high" 
              barSize={8}
              shape={(props: unknown) => {
                const p = props as { x: number; y: number; width: number; height: number; payload: CandleData };
                const { x, width, payload } = p;
                if (!payload) return <g />;
                
                const color = payload.isUp ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)";
                const candleWidth = Math.max(width * 0.7, 3);
                const wickWidth = 1;
                const centerX = x + width / 2;
                
                const yDomain = maxPrice - minPrice;
                const chartHeight = height - 50;
                const yScale = chartHeight / yDomain;
                
                const wickTopY = (maxPrice - payload.high) * yScale + 10;
                const wickBottomY = (maxPrice - payload.low) * yScale + 10;
                const bodyTopY = (maxPrice - Math.max(payload.open, payload.close)) * yScale + 10;
                const bodyBottomY = (maxPrice - Math.min(payload.open, payload.close)) * yScale + 10;
                const bodyHeight = Math.max(bodyBottomY - bodyTopY, 1);

                return (
                  <g>
                    <line
                      x1={centerX}
                      y1={wickTopY}
                      x2={centerX}
                      y2={wickBottomY}
                      stroke={color}
                      strokeWidth={wickWidth}
                    />
                    <rect
                      x={centerX - candleWidth / 2}
                      y={bodyTopY}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={color}
                      stroke={color}
                      strokeWidth={0.5}
                      rx={0.5}
                    />
                  </g>
                );
              }}
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.isUp ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)"} 
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
