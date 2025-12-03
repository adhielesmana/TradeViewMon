import { useEffect, useRef, useMemo } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketData } from "@shared/schema";

interface CandlestickChartProps {
  data: MarketData[];
  isLoading?: boolean;
  title?: string;
  height?: number;
  className?: string;
}

export function CandlestickChart({
  data,
  isLoading = false,
  title = "Candlestick Chart",
  height = 350,
  className,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const chartData = useMemo<CandlestickData<Time>[]>(() => {
    const sortedData = [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const uniqueData = new Map<number, CandlestickData<Time>>();
    
    sortedData.forEach((item) => {
      const timestamp = Math.floor(new Date(item.timestamp).getTime() / 1000) as Time;
      uniqueData.set(timestamp as number, {
        time: timestamp,
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
      });
    });

    return Array.from(uniqueData.values()).sort((a, b) => (a.time as number) - (b.time as number));
  }, [data]);

  useEffect(() => {
    if (!chartContainerRef.current || isLoading || chartData.length === 0) return;

    const isDarkMode = document.documentElement.classList.contains("dark");

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: isDarkMode ? "#09090b" : "#ffffff" },
        textColor: isDarkMode ? "#a1a1aa" : "#71717a",
      },
      grid: {
        vertLines: { color: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
        horzLines: { color: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      handleScroll: false,
      handleScale: false,
      rightPriceScale: {
        borderColor: isDarkMode ? "#27272a" : "#e4e4e7",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: isDarkMode ? "#27272a" : "#e4e4e7",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: isDarkMode ? "#52525b" : "#a1a1aa",
          width: 1,
          style: 2,
          labelBackgroundColor: isDarkMode ? "#27272a" : "#f4f4f5",
        },
        horzLine: {
          color: isDarkMode ? "#52525b" : "#a1a1aa",
          width: 1,
          style: 2,
          labelBackgroundColor: isDarkMode ? "#27272a" : "#f4f4f5",
        },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#ef4444",
    });

    candlestickSeries.setData(chartData);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const isDark = document.documentElement.classList.contains("dark");
          chart.applyOptions({
            layout: {
              background: { type: ColorType.Solid, color: isDark ? "#09090b" : "#ffffff" },
              textColor: isDark ? "#a1a1aa" : "#71717a",
            },
            grid: {
              vertLines: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
              horzLines: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
            },
          });
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [chartData, height, isLoading]);

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
        <div 
          ref={chartContainerRef} 
          data-testid="chart-candlestick"
          style={{ height }}
        />
      </CardContent>
    </Card>
  );
}
