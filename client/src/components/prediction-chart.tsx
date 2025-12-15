import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PredictionWithResult } from "@shared/schema";
import { format } from "date-fns";
import { formatPrice, getCurrencySymbol } from "@/lib/symbol-context";

interface PredictionChartProps {
  predictions: PredictionWithResult[];
  isLoading?: boolean;
  height?: number;
  className?: string;
  symbol?: string;
}

export function PredictionChart({
  predictions,
  isLoading = false,
  height = 350,
  className,
  symbol = "XAUUSD",
}: PredictionChartProps) {
  const currencySymbol = getCurrencySymbol(symbol);
  const chartData = useMemo(() => {
    return predictions.map((item) => ({
      time: format(new Date(item.targetTimestamp), "HH:mm"),
      date: format(new Date(item.targetTimestamp), "MMM dd"),
      predicted: item.predictedPrice,
      actual: item.actualPrice || null,
    }));
  }, [predictions]);

  const { minPrice, maxPrice } = useMemo(() => {
    if (predictions.length === 0) return { minPrice: 0, maxPrice: 0 };
    const allPrices = predictions.flatMap((p) => 
      [p.predictedPrice, p.actualPrice].filter(Boolean) as number[]
    );
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const padding = (max - min) * 0.1 || 1;
    return { minPrice: min - padding, maxPrice: max + padding };
  }, [predictions]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Prediction vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="w-full" style={{ height }} />
        </CardContent>
      </Card>
    );
  }

  if (predictions.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Prediction vs Actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div 
            className="flex items-center justify-center text-muted-foreground"
            style={{ height }}
          >
            No prediction data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Prediction vs Actual</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
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
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => `${currencySymbol}${value.toFixed(0)}`}
              dx={-5}
              width={60}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
              formatter={(value: number, name: string) => [
                value ? formatPrice(value, symbol) : "N/A",
                name === "predicted" ? "Predicted" : "Actual"
              ]}
            />
            <Legend 
              wrapperStyle={{ paddingTop: 20 }}
              formatter={(value) => value === "predicted" ? "Predicted" : "Actual"}
            />
            <Line
              type="monotone"
              dataKey="predicted"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
