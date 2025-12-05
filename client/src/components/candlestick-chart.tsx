import { useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MarketData } from "@shared/schema";
import { format } from "date-fns";

export type TimeframeOption = 
  | "1h-1min"
  | "3h-1min"
  | "6h-5min"
  | "1d-30min"
  | "1m-12h"
  | "6m-1d"
  | "1y-1w";

export const TIMEFRAME_LABELS: Record<TimeframeOption, string> = {
  "1h-1min": "1Hour/1Min",
  "3h-1min": "3Hours/1Min",
  "6h-5min": "6Hours/5Mins",
  "1d-30min": "1Day/30Mins",
  "1m-12h": "1Month/12Hours",
  "6m-1d": "6Month/1Day",
  "1y-1w": "1Year/1Week",
};

interface CandlestickChartProps {
  data: MarketData[];
  isLoading?: boolean;
  symbol: string;
  timeframe: TimeframeOption;
  onTimeframeChange: (timeframe: TimeframeOption) => void;
  height?: number;
  className?: string;
}

interface CandleData {
  time: string;
  timestamp: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  isUp: boolean;
  isNull: boolean;
}

interface TooltipData {
  x: number;
  y: number;
  candle: CandleData;
}

export function CandlestickChart({
  data,
  isLoading = false,
  symbol,
  timeframe,
  onTimeframeChange,
  height = 350,
  className,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Use useLayoutEffect for synchronous measurement before paint
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    
    const updateWidth = () => {
      if (containerRef.current) {
        // Use getBoundingClientRect for more accurate measurement
        const rect = containerRef.current.getBoundingClientRect();
        const width = rect.width || containerRef.current.clientWidth;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    };
    
    // Immediate measurement
    updateWidth();
    
    // Also try after a microtask to catch layout changes
    requestAnimationFrame(updateWidth);
    
    // Use ResizeObserver for proper container resize detection
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    return () => resizeObserver.disconnect();
  }, []);

  const chartData = useMemo<CandleData[]>(() => {
    const sortedData = [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const allCandles = sortedData.map((item) => {
      const timestamp = new Date(item.timestamp).getTime();
      const open = item.open != null ? Number(item.open) : null;
      const high = item.high != null ? Number(item.high) : null;
      const low = item.low != null ? Number(item.low) : null;
      const close = item.close != null ? Number(item.close) : null;
      const isNull = open === null || close === null;
      
      return {
        time: format(new Date(timestamp), "HH:mm"),
        timestamp,
        open,
        high,
        low,
        close,
        isUp: !isNull && close! >= open!,
        isNull,
      };
    });

    // Find the first non-null candle and trim leading nulls
    const firstValidIndex = allCandles.findIndex(c => !c.isNull);
    if (firstValidIndex === -1) return allCandles;
    
    return allCandles.slice(firstValidIndex);
  }, [data]);

  const { minPrice, maxPrice, yAxisTicks } = useMemo(() => {
    const validCandles = chartData.filter(d => !d.isNull);
    if (validCandles.length === 0) return { minPrice: 0, maxPrice: 0, yAxisTicks: [] };
    
    const allLows = validCandles.map((d) => d.low!);
    const allHighs = validCandles.map((d) => d.high!);
    const minData = Math.min(...allLows);
    const maxData = Math.max(...allHighs);
    
    const roundedMin = Math.floor(minData * 2) / 2 - 0.5;
    const roundedMax = Math.ceil(maxData * 2) / 2 + 0.5;
    
    const ticks: number[] = [];
    for (let tick = roundedMin; tick <= roundedMax; tick = Math.round((tick + 0.50) * 100) / 100) {
      ticks.push(tick);
    }
    
    return { 
      minPrice: roundedMin, 
      maxPrice: roundedMax,
      yAxisTicks: ticks
    };
  }, [chartData]);

  const margin = { top: 20, right: 70, bottom: 40, left: 10 };
  const chartWidth = containerWidth - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const priceToY = (price: number) => {
    const range = maxPrice - minPrice;
    if (range === 0) return chartHeight / 2;
    return ((maxPrice - price) / range) * chartHeight;
  };

  const xAxisLabels = useMemo(() => {
    if (chartData.length === 0) return [];
    const step = Math.max(1, Math.floor(chartData.length / 8));
    return chartData.filter((_, i) => i % step === 0 || i === chartData.length - 1);
  }, [chartData]);

  const title = `${symbol} CHART (${TIMEFRAME_LABELS[timeframe]})`;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg font-medium">{title}</CardTitle>
            <Select value={timeframe} onValueChange={(v) => onTimeframeChange(v as TimeframeOption)}>
              <SelectTrigger className="w-[160px]" data-testid="select-timeframe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIMEFRAME_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value} data-testid={`option-${value}`}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="w-full" style={{ height }} />
        </CardContent>
      </Card>
    );
  }

  const hasValidData = chartData.some(d => !d.isNull);

  if (data.length === 0 || !hasValidData) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg font-medium">{title}</CardTitle>
            <Select value={timeframe} onValueChange={(v) => onTimeframeChange(v as TimeframeOption)}>
              <SelectTrigger className="w-[160px]" data-testid="select-timeframe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIMEFRAME_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value} data-testid={`option-${value}`}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

  const candleWidth = containerWidth > 0 ? Math.max(chartWidth / chartData.length * 0.7, 3) : 0;
  const candleSpacing = containerWidth > 0 ? chartWidth / chartData.length : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg font-medium">{title}</CardTitle>
          <Select value={timeframe} onValueChange={(v) => onTimeframeChange(v as TimeframeOption)}>
            <SelectTrigger className="w-[160px]" data-testid="select-timeframe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TIMEFRAME_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} data-testid={`option-${value}`}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div 
          ref={containerRef}
          className="w-full"
          style={{ height, position: 'relative' }} 
          data-testid="chart-candlestick"
        >
          {containerWidth === 0 ? (
            <Skeleton className="w-full h-full" />
          ) : (
          <>
          <svg width={containerWidth} height={height} style={{ display: 'block' }}>
            <g transform={`translate(${margin.left}, ${margin.top})`}>
              {yAxisTicks.map((tick, i) => (
                <g key={`grid-${i}`}>
                  <line
                    x1={0}
                    y1={priceToY(tick)}
                    x2={chartWidth}
                    y2={priceToY(tick)}
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.3}
                    strokeDasharray="3 3"
                  />
                </g>
              ))}

              {chartData.map((candle, index) => {
                const x = index * candleSpacing + (candleSpacing - candleWidth) / 2;
                
                if (candle.isNull) {
                  return null;
                }
                
                const color = candle.isUp ? "#16a34a" : "#ef4444";
                
                const openY = priceToY(candle.open!);
                const closeY = priceToY(candle.close!);
                const highY = priceToY(candle.high!);
                const lowY = priceToY(candle.low!);
                
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
                const wickX = x + candleWidth / 2;

                return (
                  <g 
                    key={`candle-${index}`}
                    onMouseEnter={() => {
                      setTooltip({
                        x: x + margin.left + candleWidth,
                        y: bodyTop + margin.top,
                        candle
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ cursor: 'crosshair' }}
                  >
                    <line
                      x1={wickX}
                      y1={highY}
                      x2={wickX}
                      y2={lowY}
                      stroke={color}
                      strokeWidth={1.5}
                    />
                    <rect
                      x={x}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={color}
                      stroke={color}
                      strokeWidth={0.5}
                    />
                    <rect
                      x={x - 2}
                      y={highY}
                      width={candleWidth + 4}
                      height={lowY - highY}
                      fill="transparent"
                    />
                  </g>
                );
              })}

              {yAxisTicks.map((tick, i) => (
                <text
                  key={`ytick-${i}`}
                  x={chartWidth + 5}
                  y={priceToY(tick)}
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                  dominantBaseline="middle"
                >
                  ${tick.toFixed(2)}
                </text>
              ))}

              {xAxisLabels.map((candle, i) => {
                const index = chartData.findIndex(c => c.timestamp === candle.timestamp);
                const x = index * candleSpacing + candleSpacing / 2;
                return (
                  <text
                    key={`xtick-${i}`}
                    x={x}
                    y={chartHeight + 20}
                    fontSize={10}
                    fill="hsl(var(--muted-foreground))"
                    textAnchor="middle"
                  >
                    {candle.time}
                  </text>
                );
              })}
            </g>
          </svg>

          {tooltip && !tooltip.candle.isNull && (
            <div
              className="absolute bg-popover border border-border rounded-lg p-3 shadow-lg pointer-events-none z-50"
              style={{
                left: Math.min(tooltip.x + 10, containerWidth - 160),
                top: Math.max(tooltip.y - 60, 10),
              }}
            >
              <div className="text-sm font-medium mb-2">{tooltip.candle.time}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Open:</span>
                <span className="font-mono">${tooltip.candle.open!.toFixed(2)}</span>
                <span className="text-muted-foreground">High:</span>
                <span className="font-mono text-green-500">${tooltip.candle.high!.toFixed(2)}</span>
                <span className="text-muted-foreground">Low:</span>
                <span className="font-mono text-red-500">${tooltip.candle.low!.toFixed(2)}</span>
                <span className="text-muted-foreground">Close:</span>
                <span className={`font-mono ${tooltip.candle.isUp ? 'text-green-500' : 'text-red-500'}`}>
                  ${tooltip.candle.close!.toFixed(2)}
                </span>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
