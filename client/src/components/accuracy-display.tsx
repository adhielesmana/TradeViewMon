import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccuracyStats } from "@shared/schema";

interface AccuracyDisplayProps {
  stats: AccuracyStats;
  isLoading?: boolean;
  className?: string;
}

export function AccuracyDisplay({
  stats,
  isLoading = false,
  className,
}: AccuracyDisplayProps) {
  const getAccuracyColor = (percent: number) => {
    if (percent >= 70) return "text-profit";
    if (percent >= 50) return "text-yellow-500";
    return "text-loss";
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 70) return "bg-profit";
    if (percent >= 50) return "bg-yellow-500";
    return "bg-loss";
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <div className="flex animate-pulse flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-muted" />
            <div className="h-8 w-24 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-medium">
          <Target className="h-5 w-5" />
          Prediction Accuracy
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <svg className="absolute h-full w-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="8"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${stats.accuracyPercent * 2.83} 283`}
                className={getAccuracyColor(stats.accuracyPercent)}
              />
            </svg>
            <span 
              className={cn(
                "text-2xl font-bold font-mono",
                getAccuracyColor(stats.accuracyPercent)
              )}
              data-testid="text-accuracy-percent"
            >
              {stats.accuracyPercent.toFixed(1)}%
            </span>
          </div>

          <div className="w-full space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Predictions</span>
              <span className="font-mono font-medium" data-testid="text-total-predictions">
                {stats.totalPredictions}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-profit-muted">
                  <TrendingUp className="h-4 w-4 text-profit" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Matches</span>
                  <span className="font-mono font-medium text-profit" data-testid="text-match-count">
                    {stats.matchCount}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-loss-muted">
                  <TrendingDown className="h-4 w-4 text-loss" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Misses</span>
                  <span className="font-mono font-medium text-loss" data-testid="text-not-match-count">
                    {stats.notMatchCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Avg. Error</span>
                <span className="font-mono font-medium" data-testid="text-avg-error">
                  {stats.averageError.toFixed(2)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div 
                  className={cn("h-full transition-all", getProgressColor(stats.accuracyPercent))}
                  style={{ width: `${stats.accuracyPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
