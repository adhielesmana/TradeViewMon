import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { formatPrice, type SymbolInfo } from "@/lib/symbol-context";
import type { EnsembleSummary } from "@shared/schema";
import { Brain, AlertTriangle, TrendingUp, TrendingDown, Minus, ShieldCheck, Activity } from "lucide-react";

interface EnsembleSummaryCardProps {
  symbol: string;
  timeframe?: string;
  stepsAhead?: number;
  symbolInfo?: SymbolInfo | null;
  className?: string;
}

function directionIcon(direction: EnsembleSummary["direction"]) {
  switch (direction) {
    case "UP":
      return <TrendingUp className="h-4 w-4 text-profit" />;
    case "DOWN":
      return <TrendingDown className="h-4 w-4 text-loss" />;
    default:
      return <Minus className="h-4 w-4 text-yellow-500" />;
  }
}

function decisionVariant(decision: EnsembleSummary["decision"]): "default" | "secondary" | "destructive" | "outline" {
  switch (decision) {
    case "BUY":
      return "default";
    case "SELL":
      return "destructive";
    default:
      return "secondary";
  }
}

export function EnsembleSummaryCard({
  symbol,
  timeframe = "1min",
  stepsAhead = 1,
  symbolInfo,
  className,
}: EnsembleSummaryCardProps) {
  const { data, isLoading } = useQuery<EnsembleSummary & { auditId?: number | null }>({
    queryKey: ["/api/ensemble/summary", { symbol, timeframe, stepsAhead }],
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4" />
            Ensemble Forecast
          </CardTitle>
          <CardDescription>No ensemble data available yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const modelHealth = data.modelHealth || [];
  const healthyCount = modelHealth.filter((item) => item.status === "healthy").length;
  const degradedCount = modelHealth.filter((item) => item.status === "degraded").length;
  const offlineCount = modelHealth.filter((item) => item.status === "offline").length;

  return (
    <Card className={cn("overflow-hidden border-primary/20 bg-gradient-to-br from-background via-background to-muted/30", className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-primary" />
              Ensemble Forecast
            </CardTitle>
            <CardDescription className="mt-1">
              {symbol} · {data.modelType} · {timeframe}
            </CardDescription>
          </div>
          <Badge variant={decisionVariant(data.decision)} className="gap-1 font-medium">
            {directionIcon(data.direction)}
            {data.decision}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="mt-1 font-mono text-lg font-semibold">
              {formatPrice(data.currentPrice, symbolInfo)}
            </p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Forecast</p>
            <p className="mt-1 font-mono text-lg font-semibold">
              {formatPrice(data.predictedPrice, symbolInfo)}
            </p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Trust</p>
            <p className="mt-1 font-mono text-lg font-semibold text-primary">
              {data.trustScore.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">Consensus</p>
            <p className="mt-1 font-mono text-lg font-semibold">
              {data.consensusScore.toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Forecast band</span>
              <span className="font-mono">
                {formatPrice(data.forecastLower, symbolInfo)} - {formatPrice(data.forecastUpper, symbolInfo)}
              </span>
            </div>
            <div className="mt-2">
              <Progress value={Math.min(100, data.trustScore)} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Confidence {data.confidence.toFixed(1)}% · Generated {new Date(data.generatedAt).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Model health</span>
              <span className="font-mono">
                {healthyCount} healthy · {degradedCount} degraded · {offlineCount} offline
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {modelHealth.map((model) => (
                <Badge key={model.modelKey} variant={model.status === "healthy" ? "default" : model.status === "offline" ? "destructive" : "secondary"} className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {model.displayName}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {data.abstainReason && (
          <Alert className="border-yellow-500/30 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{data.abstainReason}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Model contributions</p>
            <span className="text-xs text-muted-foreground">
              {data.modelContributions.length} contributors
            </span>
          </div>
          <div className="grid gap-2">
            {data.modelContributions.map((model) => (
              <div key={model.modelKey} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{model.displayName}</span>
                    <Badge variant={model.direction === "UP" ? "default" : model.direction === "DOWN" ? "destructive" : "secondary"} className="gap-1">
                      {model.direction === "UP" ? <TrendingUp className="h-3 w-3" /> : model.direction === "DOWN" ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                      {model.direction}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Activity className="h-3 w-3" />
                      {model.weight.toFixed(2)}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{model.rationale}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  <p className="font-mono text-sm font-medium">{model.confidence.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
