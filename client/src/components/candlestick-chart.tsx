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
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isUp: boolean;
  bodyBottom: number;
  bodyHeight: number;
  wickLow: number;
  wickHigh: number;
}

const CandlestickBar = (props: any) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  
  const { open, high, low, close, isUp } = payload;
  const color = isUp ? "#16a34a" : "#ef4444";
  
  const barWidth = Math.max(width * 0.8, 4);
  const barX = x + (width - barWidth) / 2;
  
  const yScale = props.yScale || ((val: number) => y);
  
  const bodyTop = yScale(Math.max(open, close));
  const bodyBottom = yScale(Math.min(open, close));
  const bodyHeight = Math.max(Math.abs(bodyBottom - bodyTop), 1);
  
  const wickX = barX + barWidth / 2;
  const wickTop = yScale(high);
  const wickBottom = yScale(low);
  
  return (
    <g>
      <line
        x1={wickX}
        y1={wickTop}
        x2={wickX}
        y2={wickBottom}
        stroke={color}
        strokeWidth={1}
      />
      <rect
        x={barX}
        y={bodyTop}
        width={barWidth}
        height={bodyHeight}
        fill={color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
};

export function CandlestickChart({
  data,
  isLoading = false,
  title = "Candlestick Chart",
  height = 350,
  className,
}: CandlestickChartProps) {
  const chartData = useMemo<CandleData[]>(() => {
    const sortedData = [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const uniqueData = new Map<number, CandleData>();
    
    sortedData.forEach((item) => {
      const timestamp = Math.floor(new Date(item.timestamp).getTime() / 60000) * 60000;
      const open = Number(item.open);
      const high = Number(item.high);
      const low = Number(item.low);
      const close = Number(item.close);
      const isUp = close >= open;
      
      uniqueData.set(timestamp, {
        time: format(new Date(timestamp), "HH:mm"),
        timestamp,
        open,
        high,
        low,
        close,
        isUp,
        bodyBottom: Math.min(open, close),
        bodyHeight: Math.abs(close - open),
        wickLow: low,
        wickHigh: high,
      });
    });

    return Array.from(uniqueData.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [data]);

  const { minPrice, maxPrice, yAxisTicks } = useMemo(() => {
    if (chartData.length === 0) return { minPrice: 0, maxPrice: 0, yAxisTicks: [] };
    
    const allLows = chartData.map((d) => d.low);
    const allHighs = chartData.map((d) => d.high);
    const minData = Math.min(...allLows);
    const maxData = Math.max(...allHighs);
    
    const roundedMin = Math.floor(minData * 10) / 10 - 0.2;
    const roundedMax = Math.ceil(maxData * 10) / 10 + 0.2;
    
    const ticks: number[] = [];
    for (let tick = roundedMin; tick <= roundedMax; tick = Math.round((tick + 0.10) * 100) / 100) {
      ticks.push(tick);
    }
    
    return { 
      minPrice: roundedMin, 
      maxPrice: roundedMax,
      yAxisTicks: ticks
    };
  }, [chartData]);

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
        <ResponsiveContainer width="100%" height={height} data-testid="chart-candlestick">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="hsl(var(--border))" 
              opacity={0.4}
              horizontal={true}
              vertical={true}
            />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              dy={10}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minPrice, maxPrice]}
              ticks={yAxisTicks}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => `$${value.toFixed(2)}`}
              width={75}
              orientation="right"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  open: "Open",
                  high: "High", 
                  low: "Low",
                  close: "Close",
                };
                return [`$${value.toFixed(2)}`, labels[name] || name];
              }}
              labelFormatter={(label) => `Time: ${label}`}
            />
            {chartData.map((entry, index) => {
              const color = entry.isUp ? "#16a34a" : "#ef4444";
              const barWidth = Math.max(100 / chartData.length * 0.6, 2);
              
              return (
                <ReferenceLine
                  key={`wick-${index}`}
                  segment={[
                    { x: entry.time, y: entry.low },
                    { x: entry.time, y: entry.high }
                  ]}
                  stroke={color}
                  strokeWidth={1}
                />
              );
            })}
            <Bar 
              dataKey="bodyHeight" 
              stackId="candle"
              fill="#16a34a"
              stroke="none"
              barSize={8}
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.isUp ? "#16a34a" : "#ef4444"}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
