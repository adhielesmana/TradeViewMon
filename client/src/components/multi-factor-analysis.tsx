import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";

interface FactorSignal {
  name: string;
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  weight: number;
  value: number;
  description: string;
}

interface MultiFactorAnalysisData {
  factors: FactorSignal[];
  overallSignal: "BUY" | "SELL" | "HOLD";
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  signalStrength: number;
}

interface MultiFactorApiResponse {
  analysis: MultiFactorAnalysisData;
  symbol: string;
  dataPoints: number;
  timestamp: string;
}

interface MultiFactorAnalysisProps {
  symbol: string;
}

export function MultiFactorAnalysis({ symbol }: MultiFactorAnalysisProps) {
  const { data: response, isLoading } = useQuery<MultiFactorApiResponse>({
    queryKey: ["/api/predictions/multifactor", { symbol }],
    refetchInterval: 60000,
  });

  const data = response?.analysis;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Multi-Factor Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.factors.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Multi-Factor Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Insufficient data for multi-factor analysis. More price history is needed.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getSignalIcon = (signal: "BULLISH" | "BEARISH" | "NEUTRAL") => {
    switch (signal) {
      case "BULLISH":
        return <TrendingUp className="h-3.5 w-3.5" />;
      case "BEARISH":
        return <TrendingDown className="h-3.5 w-3.5" />;
      default:
        return <Minus className="h-3.5 w-3.5" />;
    }
  };

  const getSignalBadgeVariant = (signal: "BULLISH" | "BEARISH" | "NEUTRAL") => {
    switch (signal) {
      case "BULLISH":
        return "default" as const;
      case "BEARISH":
        return "destructive" as const;
      default:
        return "secondary" as const;
    }
  };

  const getOverallSignalStyles = () => {
    switch (data.overallSignal) {
      case "BUY":
        return "bg-profit/10 text-profit border-profit/30";
      case "SELL":
        return "bg-loss/10 text-loss border-loss/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Multi-Factor Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`flex items-center justify-between rounded-lg border p-4 ${getOverallSignalStyles()}`}
          data-testid="signal-overall"
        >
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider opacity-70">
              Overall Signal
            </p>
            <p className="text-2xl font-bold" data-testid="text-overall-signal">
              {data.overallSignal}
            </p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider opacity-70">
              Strength
            </p>
            <p className="text-xl font-semibold" data-testid="text-signal-strength">
              {data.signalStrength}%
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-profit/10 p-2">
            <p className="text-lg font-semibold text-profit" data-testid="text-bullish-count">
              {data.bullishCount}
            </p>
            <p className="text-xs text-muted-foreground">Bullish</p>
          </div>
          <div className="rounded-md bg-muted p-2">
            <p className="text-lg font-semibold" data-testid="text-neutral-count">
              {data.neutralCount}
            </p>
            <p className="text-xs text-muted-foreground">Neutral</p>
          </div>
          <div className="rounded-md bg-loss/10 p-2">
            <p className="text-lg font-semibold text-loss" data-testid="text-bearish-count">
              {data.bearishCount}
            </p>
            <p className="text-xs text-muted-foreground">Bearish</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Factor Breakdown</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.factors.map((factor, index) => (
              <div
                key={`${factor.name}-${index}`}
                className="flex items-start justify-between gap-2 rounded-md border p-2.5"
                data-testid={`factor-${factor.name.toLowerCase().replace(/\s+/g, "-")}-${index}`}
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{factor.name}</span>
                    <Badge
                      variant={getSignalBadgeVariant(factor.signal)}
                      className="flex items-center gap-1 text-xs shrink-0"
                    >
                      {getSignalIcon(factor.signal)}
                      {factor.signal}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {factor.description}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">Weight</p>
                  <p className="text-sm font-medium">{factor.weight}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
          <div className="relative h-2 rounded-full bg-gradient-to-r from-loss via-muted to-profit overflow-hidden">
            <div
              className="absolute top-0 h-full w-1 bg-foreground rounded-full transition-all duration-300"
              style={{
                left: `calc(${50 + (data.bullishCount - data.bearishCount) / (data.factors.length || 1) * 40}% - 2px)`,
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
