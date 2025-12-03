import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketData } from "@shared/schema";
import { format } from "date-fns";

interface MarketChartProps {
  data: MarketData[];
  isLoading?: boolean;
  title?: string;
  height?: number;
  showVolume?: boolean;
  className?: string;
}

export function MarketChart({
  data,
  isLoading = false,
  title = "Price Chart",
  height = 300,
  showVolume = false,
  className,
}: MarketChartProps) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      time: format(new Date(item.timestamp), "HH:mm"),
      date: format(new Date(item.timestamp), "MMM dd"),
    }));
  }, [data]);

  const { minPrice, maxPrice, avgPrice, yAxisTicks } = useMemo(() => {
    if (data.length === 0) return { minPrice: 0, maxPrice: 0, avgPrice: 0, yAxisTicks: [] };
    
    const allLows = data.map((d) => d.low);
    const allHighs = data.map((d) => d.high);
    const minData = Math.min(...allLows);
    const maxData = Math.max(...allHighs);
    const avg = data.map(d => d.close).reduce((a, b) => a + b, 0) / data.length;
    
    const roundedMin = Math.floor(minData * 10) / 10 - 0.1;
    const roundedMax = Math.ceil(maxData * 10) / 10 + 0.1;
    
    const ticks: number[] = [];
    for (let tick = roundedMin; tick <= roundedMax; tick = Math.round((tick + 0.10) * 100) / 100) {
      ticks.push(tick);
    }
    
    return { 
      minPrice: roundedMin, 
      maxPrice: roundedMax,
      avgPrice: avg,
      yAxisTicks: ticks
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

  const priceChange = data.length > 1 ? data[data.length - 1].close - data[0].close : 0;
  const lineColor = priceChange >= 0 ? "rgb(34 197 94)" : "rgb(239 68 68)";
  const gradientId = `gradient-${priceChange >= 0 ? 'profit' : 'loss'}`;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
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
            />
            <YAxis
              domain={[minPrice, maxPrice]}
              ticks={yAxisTicks}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => `$${value.toFixed(2)}`}
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
              itemStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, "Close"]}
            />
            <ReferenceLine 
              y={avgPrice} 
              stroke="hsl(var(--muted-foreground))" 
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke="none"
              fill={`url(#${gradientId})`}
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--background))" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
