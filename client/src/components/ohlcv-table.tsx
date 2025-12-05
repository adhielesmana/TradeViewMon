import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { MarketData } from "@shared/schema";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface OHLCVTableProps {
  data: MarketData[];
  isLoading?: boolean;
  maxHeight?: number;
  className?: string;
}

export function OHLCVTable({
  data,
  isLoading = false,
  maxHeight = 400,
  className,
}: OHLCVTableProps) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">OHLCV Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">OHLCV Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No historical data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">OHLCV Data</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea style={{ maxHeight }} className="px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold sticky top-0 bg-card">Date</TableHead>
                <TableHead className="text-xs font-semibold text-right sticky top-0 bg-card">Open</TableHead>
                <TableHead className="text-xs font-semibold text-right sticky top-0 bg-card">High</TableHead>
                <TableHead className="text-xs font-semibold text-right sticky top-0 bg-card">Low</TableHead>
                <TableHead className="text-xs font-semibold text-right sticky top-0 bg-card">Close</TableHead>
                <TableHead className="text-xs font-semibold text-right sticky top-0 bg-card">Volume</TableHead>
                <TableHead className="text-xs font-semibold text-center sticky top-0 bg-card">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data].reverse().map((candle, index) => {
                const change = candle.close - candle.open;
                const changePercent = (change / candle.open) * 100;
                const isPositive = change >= 0;

                return (
                  <TableRow key={candle.id || index} data-testid={`row-ohlcv-${candle.id || index}`}>
                    <TableCell className="py-2">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">
                          {format(new Date(candle.timestamp), "MMM dd, yyyy")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(candle.timestamp), "HH:mm:ss")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm">
                      ${candle.open.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm text-profit">
                      ${candle.high.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm text-loss">
                      ${candle.low.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm font-medium">
                      ${candle.close.toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm text-muted-foreground">
                      {(candle.volume / 1000).toFixed(1)}K
                    </TableCell>
                    <TableCell className="py-2">
                      <div className={cn(
                        "flex items-center justify-center gap-1 text-xs font-medium",
                        isPositive ? "text-profit" : "text-loss"
                      )}>
                        {isPositive ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        <span>{isPositive ? "+" : ""}{changePercent.toFixed(2)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
