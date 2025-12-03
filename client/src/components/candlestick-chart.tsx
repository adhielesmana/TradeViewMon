import { useMemo, useRef, useEffect, useState } from "react";
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
}

interface TooltipData {
  x: number;
  y: number;
  candle: CandleData;
}

export function CandlestickChart({
  data,
  isLoading = false,
  title = "Candlestick Chart",
  height = 350,
  className,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

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
      
      uniqueData.set(timestamp, {
        time: format(new Date(timestamp), "HH:mm"),
        timestamp,
        open,
        high,
        low,
        close,
        isUp: close >= open,
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

  const candleWidth = Math.max(chartWidth / chartData.length * 0.7, 3);
  const candleSpacing = chartWidth / chartData.length;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div 
          ref={containerRef}
          style={{ width: '100%', height, position: 'relative' }} 
          data-testid="chart-candlestick"
        >
          <svg width="100%" height={height}>
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
                const color = candle.isUp ? "#16a34a" : "#ef4444";
                
                const openY = priceToY(candle.open);
                const closeY = priceToY(candle.close);
                const highY = priceToY(candle.high);
                const lowY = priceToY(candle.low);
                
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
                const wickX = x + candleWidth / 2;

                return (
                  <g 
                    key={`candle-${index}`}
                    onMouseEnter={(e) => {
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) {
                        setTooltip({
                          x: x + margin.left + candleWidth,
                          y: bodyTop + margin.top,
                          candle
                        });
                      }
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

          {tooltip && (
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
                <span className="font-mono">${tooltip.candle.open.toFixed(2)}</span>
                <span className="text-muted-foreground">High:</span>
                <span className="font-mono text-green-500">${tooltip.candle.high.toFixed(2)}</span>
                <span className="text-muted-foreground">Low:</span>
                <span className="font-mono text-red-500">${tooltip.candle.low.toFixed(2)}</span>
                <span className="text-muted-foreground">Close:</span>
                <span className={`font-mono ${tooltip.candle.isUp ? 'text-green-500' : 'text-red-500'}`}>
                  ${tooltip.candle.close.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
