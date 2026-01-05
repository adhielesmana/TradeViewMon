import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Play, TrendingUp, TrendingDown, Target, Percent, Activity, BarChart2, Clock, AlertTriangle } from "lucide-react";
import { useSymbol, formatPrice, getCurrencySymbol } from "@/lib/symbol-context";
import { apiRequest } from "@/lib/queryClient";
import { format, subDays, subMonths } from "date-fns";

interface BacktestTrade {
  timestamp: string;
  predictedPrice: number;
  actualPrice: number;
  predictedDirection: "UP" | "DOWN" | "NEUTRAL";
  actualDirection: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  priceDifference: number;
  percentageDifference: number;
  isDirectionMatch: boolean;
  isPriceMatch: boolean;
}

interface BacktestMetrics {
  totalTrades: number;
  directionAccuracy: number;
  priceAccuracy: number;
  averageError: number;
  maxError: number;
  minError: number;
  profitableTrades: number;
  lossTrades: number;
  neutralTrades: number;
  avgConfidence: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winStreak: number;
  lossStreak: number;
  currentStreak: { type: "win" | "loss"; count: number };
}

interface BacktestResult {
  config: {
    symbol: string;
    startDate: string;
    endDate: string;
    timeframe: string;
    lookbackPeriod: number;
  };
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { timestamp: string; equity: number }[];
  runTime: number;
  totalTradesInBacktest: number;
}

function MetricCard({ 
  label, 
  value, 
  subValue,
  icon: Icon, 
  variant = "default",
  testId
}: { 
  label: string; 
  value: string | number; 
  subValue?: string;
  icon: React.ElementType; 
  variant?: "default" | "profit" | "loss" | "warning";
  testId: string;
}) {
  const valueColor = {
    default: "text-foreground",
    profit: "text-profit",
    loss: "text-loss",
    warning: "text-yellow-500"
  }[variant];

  return (
    <Card data-testid={testId}>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-xl font-semibold font-mono ${valueColor}`}>{value}</p>
            {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Backtesting() {
  const { currentSymbol } = useSymbol();
  const symbol = currentSymbol.symbol;
  
  const [timeframe, setTimeframe] = useState<"1min" | "5min">("1min");
  const [period, setPeriod] = useState("7d");
  const [result, setResult] = useState<BacktestResult | null>(null);

  const getDateRange = (periodValue: string) => {
    const end = new Date();
    let start: Date;
    
    switch (periodValue) {
      case "1d": start = subDays(end, 1); break;
      case "3d": start = subDays(end, 3); break;
      case "7d": start = subDays(end, 7); break;
      case "14d": start = subDays(end, 14); break;
      case "1m": start = subMonths(end, 1); break;
      case "3m": start = subMonths(end, 3); break;
      default: start = subDays(end, 7);
    }
    
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  };

  const backtestMutation = useMutation({
    mutationFn: async () => {
      const { startDate, endDate } = getDateRange(period);
      const response = await apiRequest("POST", "/api/backtest/run", {
        symbol,
        startDate,
        endDate,
        timeframe,
      });
      return await response.json() as BacktestResult;
    },
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const formatEquityCurve = (curve: { timestamp: string; equity: number }[]) => {
    return curve.map((point, index) => ({
      ...point,
      index,
      time: format(new Date(point.timestamp), "MM/dd HH:mm"),
    }));
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backtesting</h1>
          <p className="text-sm text-muted-foreground">
            Evaluate prediction model performance on historical data
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configure Backtest</CardTitle>
          <CardDescription>Select parameters for the backtest simulation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input value={symbol} disabled data-testid="input-backtest-symbol" />
            </div>
            
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger data-testid="select-backtest-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">Last 1 Day</SelectItem>
                  <SelectItem value="3d">Last 3 Days</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="14d">Last 14 Days</SelectItem>
                  <SelectItem value="1m">Last 1 Month</SelectItem>
                  <SelectItem value="3m">Last 3 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select value={timeframe} onValueChange={(v) => setTimeframe(v as "1min" | "5min")}>
                <SelectTrigger data-testid="select-backtest-timeframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1min">1 Minute</SelectItem>
                  <SelectItem value="5min">5 Minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-end">
              <Button 
                onClick={() => backtestMutation.mutate()}
                disabled={backtestMutation.isPending}
                className="w-full"
                data-testid="button-run-backtest"
              >
                {backtestMutation.isPending ? (
                  <>Running...</>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Backtest
                  </>
                )}
              </Button>
            </div>
          </div>
          
          {backtestMutation.isError && (
            <div className="mt-4 flex items-center gap-2 text-loss">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">
                {backtestMutation.error instanceof Error 
                  ? backtestMutation.error.message 
                  : "Failed to run backtest"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {backtestMutation.isPending && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      )}

      {result && !backtestMutation.isPending && (
        <>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {result.config.symbol}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {result.config.timeframe}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {result.totalTradesInBacktest} trades analyzed in {result.runTime}ms
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Direction Accuracy"
              value={`${result.metrics.directionAccuracy}%`}
              icon={Target}
              variant={result.metrics.directionAccuracy >= 50 ? "profit" : "loss"}
              testId="text-direction-accuracy"
            />
            <MetricCard
              label="Price Accuracy"
              value={`${result.metrics.priceAccuracy}%`}
              icon={Percent}
              variant={result.metrics.priceAccuracy >= 50 ? "profit" : "loss"}
              testId="text-price-accuracy"
            />
            <MetricCard
              label="Average Error"
              value={`${result.metrics.averageError}%`}
              subValue={`Max: ${result.metrics.maxError}%`}
              icon={Activity}
              testId="text-average-error"
            />
            <MetricCard
              label="Sharpe Ratio"
              value={result.metrics.sharpeRatio.toFixed(2)}
              icon={BarChart2}
              variant={result.metrics.sharpeRatio >= 1 ? "profit" : result.metrics.sharpeRatio >= 0 ? "default" : "loss"}
              testId="text-sharpe-ratio"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Profitable Trades"
              value={result.metrics.profitableTrades}
              subValue={`${Math.round((result.metrics.profitableTrades / result.metrics.totalTrades) * 100)}%`}
              icon={TrendingUp}
              variant="profit"
              testId="text-profitable-trades"
            />
            <MetricCard
              label="Loss Trades"
              value={result.metrics.lossTrades}
              subValue={`${Math.round((result.metrics.lossTrades / result.metrics.totalTrades) * 100)}%`}
              icon={TrendingDown}
              variant="loss"
              testId="text-loss-trades"
            />
            <MetricCard
              label="Max Drawdown"
              value={`${result.metrics.maxDrawdown}%`}
              icon={AlertTriangle}
              variant={result.metrics.maxDrawdown > 10 ? "loss" : "warning"}
              testId="text-max-drawdown"
            />
            <MetricCard
              label="Win Streak"
              value={result.metrics.winStreak}
              subValue={`Loss streak: ${result.metrics.lossStreak}`}
              icon={Clock}
              testId="text-win-streak"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Equity Curve</CardTitle>
              <CardDescription>
                Simulated portfolio performance (starting $10,000)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.equityCurve.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={formatEquityCurve(result.equityCurve)}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                    />
                    <YAxis 
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => `${getCurrencySymbol(currentSymbol)}${(v / 1000).toFixed(1)}k`}
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      formatter={(value: number) => [`${getCurrencySymbol(currentSymbol)}${value.toLocaleString()}`, 'Equity']}
                    />
                    <ReferenceLine 
                      y={10000} 
                      stroke="hsl(var(--muted-foreground))" 
                      strokeDasharray="3 3" 
                    />
                    <Line 
                      type="monotone" 
                      dataKey="equity" 
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  No equity data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Trades</CardTitle>
              <CardDescription>
                Last {result.trades.length} trades from the backtest
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b">
                      <th className="py-2 text-left font-medium">Time</th>
                      <th className="py-2 text-right font-medium">Predicted</th>
                      <th className="py-2 text-right font-medium">Actual</th>
                      <th className="py-2 text-center font-medium">Direction</th>
                      <th className="py-2 text-right font-medium">Error</th>
                      <th className="py-2 text-center font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-50).reverse().map((trade, index) => (
                      <tr key={index} className="border-b border-border/50">
                        <td className="py-2 font-mono text-xs">
                          {format(new Date(trade.timestamp), "MM/dd HH:mm")}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {formatPrice(trade.predictedPrice, currentSymbol)}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {formatPrice(trade.actualPrice, currentSymbol)}
                        </td>
                        <td className="py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Badge 
                              variant={trade.predictedDirection === "UP" ? "default" : trade.predictedDirection === "DOWN" ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {trade.predictedDirection}
                            </Badge>
                            <span className="text-muted-foreground">/</span>
                            <Badge 
                              variant={trade.actualDirection === "UP" ? "default" : trade.actualDirection === "DOWN" ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {trade.actualDirection}
                            </Badge>
                          </div>
                        </td>
                        <td className={`py-2 text-right font-mono ${Math.abs(trade.percentageDifference) > 1 ? 'text-loss' : 'text-muted-foreground'}`}>
                          {trade.percentageDifference.toFixed(2)}%
                        </td>
                        <td className="py-2 text-center">
                          {trade.isDirectionMatch ? (
                            <Badge variant="outline" className="text-profit border-profit">
                              Match
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-loss border-loss">
                              Miss
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!result && !backtestMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No Backtest Results</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Configure and run a backtest to see model performance analysis
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
