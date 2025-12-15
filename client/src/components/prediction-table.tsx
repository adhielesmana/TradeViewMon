import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { PredictionWithResult } from "@shared/schema";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/symbol-context";

interface PredictionTableProps {
  predictions: PredictionWithResult[];
  isLoading?: boolean;
  maxHeight?: number;
  className?: string;
  symbol?: string;
}

export function PredictionTable({
  predictions,
  isLoading = false,
  maxHeight = 400,
  className,
  symbol = "XAUUSD",
}: PredictionTableProps) {
  const DirectionIcon = ({ direction }: { direction: string }) => {
    if (direction === "UP") return <TrendingUp className="h-3 w-3 text-profit" />;
    if (direction === "DOWN") return <TrendingDown className="h-3 w-3 text-loss" />;
    return <Minus className="h-3 w-3 text-neutral" />;
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Recent Predictions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (predictions.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Recent Predictions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No predictions yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Recent Predictions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea style={{ maxHeight }} className="px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">Time</TableHead>
                <TableHead className="text-xs font-semibold text-right">Predicted</TableHead>
                <TableHead className="text-xs font-semibold text-right">Actual</TableHead>
                <TableHead className="text-xs font-semibold text-right">Diff %</TableHead>
                <TableHead className="text-xs font-semibold text-center">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {predictions.map((prediction, index) => (
                <TableRow key={prediction.id || index} data-testid={`row-prediction-${prediction.id || index}`}>
                  <TableCell className="py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">
                        {format(new Date(prediction.targetTimestamp), "MMM dd")}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {format(new Date(prediction.targetTimestamp), "HH:mm:ss")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <DirectionIcon direction={prediction.predictedDirection} />
                      <span className="font-mono text-sm">
                        {formatPrice(prediction.predictedPrice, symbol)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm">
                    {prediction.actualPrice 
                      ? formatPrice(prediction.actualPrice, symbol)
                      : <span className="text-muted-foreground">--</span>
                    }
                  </TableCell>
                  <TableCell className={cn(
                    "py-2 text-right font-mono text-sm",
                    prediction.percentageDifference !== undefined && (
                      Math.abs(prediction.percentageDifference) <= 0.5 
                        ? "text-profit" 
                        : "text-loss"
                    )
                  )}>
                    {prediction.percentageDifference !== undefined 
                      ? `${prediction.percentageDifference >= 0 ? '+' : ''}${prediction.percentageDifference.toFixed(2)}%`
                      : <span className="text-muted-foreground">--</span>
                    }
                  </TableCell>
                  <TableCell className="py-2 text-center">
                    {prediction.isMatch !== undefined ? (
                      prediction.isMatch ? (
                        <Badge 
                          variant="outline" 
                          className="bg-profit-muted text-profit border-profit/30 gap-1 text-xs"
                          data-testid={`badge-match-${prediction.id}`}
                        >
                          <Check className="h-3 w-3" />
                          Match
                        </Badge>
                      ) : (
                        <Badge 
                          variant="outline" 
                          className="bg-loss-muted text-loss border-loss/30 gap-1 text-xs"
                          data-testid={`badge-not-match-${prediction.id}`}
                        >
                          <X className="h-3 w-3" />
                          Miss
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Pending
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
