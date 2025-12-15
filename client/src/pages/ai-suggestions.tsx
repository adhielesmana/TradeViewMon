import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Target,
  Clock,
  Brain,
  CheckCircle2,
  XCircle,
  BarChart3,
  Zap,
  RefreshCw,
  CandlestickChart as CandlestickIcon,
  AlertTriangle
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useSymbol, formatPrice, getCurrencySymbol } from "@/lib/symbol-context";
import { useWebSocket, type WSMessage } from "@/hooks/use-websocket";
import { queryClient } from "@/lib/queryClient";
import type { AiSuggestionAccuracyStats, MarketData } from "@shared/schema";
import { CandlestickChart, type TimeframeOption } from "@/components/candlestick-chart";

interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: number;
  description: string;
  candleIndex: number;
  timestamp: string;
}

interface SuggestionReason {
  indicator: string;
  signal: "bullish" | "bearish" | "neutral";
  description: string;
  weight: number;
}

interface TechnicalIndicators {
  ema12: number;
  ema26: number;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  stochK: number;
  stochD: number;
  atr: number;
  currentPrice: number;
  candlestickPatterns?: CandlestickPattern[];
}

interface PrecisionTradePlan {
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
  supportLevel: number;
  resistanceLevel: number;
  signalType: "immediate" | "pending";
  validUntil: string;
  riskAmount: number;
  potentialReward: number;
  analysis: string;
}

interface AiSuggestion {
  id: number;
  symbol: string;
  generatedAt: string;
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  buyTarget: number | null;
  sellTarget: number | null;
  currentPrice: number;
  reasoning: SuggestionReason[];
  indicators: TechnicalIndicators;
  isEvaluated: boolean;
  evaluatedAt: string | null;
  actualPrice: number | null;
  wasAccurate: boolean | null;
  profitLoss: number | null;
  // Precision Trade Plan fields
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskRewardRatio: number | null;
  supportLevel: number | null;
  resistanceLevel: number | null;
  signalType: string | null;
  validUntil: string | null;
  tradePlan: string | null;
}

function getDecisionColor(decision: string): string {
  switch (decision) {
    case "BUY":
      return "text-green-500";
    case "SELL":
      return "text-red-500";
    default:
      return "text-yellow-500";
  }
}

function getDecisionBgColor(decision: string): string {
  switch (decision) {
    case "BUY":
      return "bg-green-500/10 border-green-500/30";
    case "SELL":
      return "bg-red-500/10 border-red-500/30";
    default:
      return "bg-yellow-500/10 border-yellow-500/30";
  }
}

function getSignalBadgeVariant(signal: string): "default" | "secondary" | "destructive" | "outline" {
  switch (signal) {
    case "bullish":
      return "default";
    case "bearish":
      return "destructive";
    default:
      return "secondary";
  }
}

function DecisionIcon({ decision }: { decision: string }) {
  switch (decision) {
    case "BUY":
      return <TrendingUp className="h-8 w-8 text-green-500" />;
    case "SELL":
      return <TrendingDown className="h-8 w-8 text-red-500" />;
    default:
      return <Minus className="h-8 w-8 text-yellow-500" />;
  }
}

export default function AiSuggestions() {
  const { currentSymbol } = useSymbol();
  const symbol = currentSymbol.symbol;
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [chartTimeframe] = useState<TimeframeOption>("3h-1min");

  const handleWSMessage = useCallback((message: WSMessage) => {
    const matchesSymbol = !message.symbol || message.symbol === symbol;
    
    if (message.type === "suggestion_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions/latest", { symbol }] });
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions/recent", { symbol, limit: 10 }] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/candles", { symbol, timeframe: chartTimeframe }] });
      queryClient.invalidateQueries({ queryKey: ["/api/market/patterns", { symbol, timeframe: chartTimeframe }] });
      setLastUpdate(new Date());
    } else if (message.type === "suggestion_accuracy_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions/accuracy", { symbol }] });
      queryClient.invalidateQueries({ queryKey: ["/api/suggestions/recent", { symbol, limit: 10 }] });
    } else if (message.type === "market_update" && matchesSymbol) {
      queryClient.invalidateQueries({ queryKey: ["/api/market/candles", { symbol, timeframe: chartTimeframe }] });
    }
  }, [symbol, chartTimeframe]);

  useWebSocket({
    symbol,
    onMessage: handleWSMessage,
  });

  const { data: latestSuggestion, isLoading: isLoadingLatest } = useQuery<AiSuggestion | null>({
    queryKey: ["/api/suggestions/latest", { symbol }],
    refetchInterval: 60000,
  });

  const { data: recentSuggestions, isLoading: isLoadingRecent } = useQuery<AiSuggestion[]>({
    queryKey: ["/api/suggestions/recent", { symbol, limit: 10 }],
    refetchInterval: 60000,
  });

  const { data: accuracyStats, isLoading: isLoadingAccuracy } = useQuery<AiSuggestionAccuracyStats>({
    queryKey: ["/api/suggestions/accuracy", { symbol }],
    refetchInterval: 60000,
  });

  const { data: candleData, isLoading: isLoadingCandles } = useQuery<MarketData[]>({
    queryKey: ["/api/market/candles", { symbol, timeframe: chartTimeframe }],
    refetchInterval: 60000,
  });

  // Extract pattern info from the reasoning to ensure consistency
  // Use filter().at(-1) to get the LAST matching entry (most recent), same as Analysis Breakdown
  const patternReasons = latestSuggestion?.reasoning?.filter(r => r.indicator === "Candlestick Patterns") || [];
  const patternFromReasoning = patternReasons.at(-1);
  // Show pattern card for both bullish/bearish AND neutral patterns to match Analysis Breakdown display
  const patternData = patternFromReasoning && latestSuggestion
    ? {
        // Parse pattern name from description (format: "PatternName: description")
        patternName: patternFromReasoning.description.includes(":") 
          ? patternFromReasoning.description.split(":")[0]?.trim() || "Pattern"
          : patternFromReasoning.description.split(" - ")[0]?.trim() || "Pattern",
        patternType: patternFromReasoning.signal as "bullish" | "bearish" | "neutral",
        patternDescription: patternFromReasoning.description,
        patternStrength: Math.min(5, Math.ceil(patternFromReasoning.weight / 8)), // Convert weight to 1-5 strength
        // Derive trend from suggestion decision
        trend: latestSuggestion.decision === "BUY" ? "uptrend" 
             : latestSuggestion.decision === "SELL" ? "downtrend" 
             : "sideways",
        // Keep track of whether it's a real pattern or just "no patterns detected"
        isRealPattern: !patternFromReasoning.description.toLowerCase().includes("no significant")
      }
    : null;

  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 60;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdate]);

  if (isLoadingLatest || isLoadingAccuracy) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Trading Suggestions</h1>
          <p className="text-muted-foreground">
            Smart buy/sell recommendations for {symbol}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
          <span data-testid="text-countdown">Next update in {countdown}s</span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">Total Suggestions</div>
              <Brain className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-bold" data-testid="text-total-suggestions">
              {accuracyStats?.totalSuggestions || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">Evaluated</div>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-bold" data-testid="text-evaluated-count">
              {accuracyStats?.evaluatedCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">Accuracy Rate</div>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </div>
            <div className="mt-2 text-2xl font-bold text-green-500" data-testid="text-accuracy-rate">
              {(accuracyStats?.accuracyPercent || 0).toFixed(1)}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">Avg Profit/Loss</div>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className={`mt-2 text-2xl font-bold ${(accuracyStats?.avgProfitLoss || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="text-avg-profit-loss">
              {(accuracyStats?.avgProfitLoss || 0) >= 0 ? '+' : ''}{(accuracyStats?.avgProfitLoss || 0).toFixed(2)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {latestSuggestion && (
        <Card className={`border-2 ${getDecisionBgColor(latestSuggestion.decision)}`}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DecisionIcon decision={latestSuggestion.decision} />
                <div>
                  <span className={`text-3xl font-bold ${getDecisionColor(latestSuggestion.decision)}`} data-testid="text-current-decision">
                    {latestSuggestion.decision}
                  </span>
                  <span className="ml-3 text-lg text-muted-foreground">
                    {latestSuggestion.confidence}% confidence
                  </span>
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <Clock className="inline h-4 w-4 mr-1" />
                {formatDistanceToNow(new Date(latestSuggestion.generatedAt), { addSuffix: true })}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Precision Trade Plan - Main Display */}
            {latestSuggestion.decision !== "HOLD" && latestSuggestion.entryPrice && (
              <div className="mb-6 p-4 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border-2 border-primary/30">
                <div className="flex items-center gap-2 mb-4">
                  <Target className="h-5 w-5 text-primary" />
                  <span className="font-bold text-lg">Precision Trade Plan</span>
                  <Badge variant={latestSuggestion.signalType === "immediate" ? "default" : "secondary"}>
                    {latestSuggestion.signalType === "immediate" ? "Execute Now" : "Pending Order"}
                  </Badge>
                  {latestSuggestion.riskRewardRatio && (
                    <Badge variant="outline" className="ml-auto">
                      R:R {latestSuggestion.riskRewardRatio.toFixed(1)}:1
                    </Badge>
                  )}
                </div>
                
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {/* Entry Price */}
                  <div className="p-3 rounded-md bg-background border-2 border-primary/50">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> ENTRY PRICE
                    </div>
                    <div className="text-xl font-mono font-bold text-primary" data-testid="text-entry-price">
                      {formatPrice(latestSuggestion.entryPrice, symbol)}
                    </div>
                  </div>
                  
                  {/* Stop Loss */}
                  <div className="p-3 rounded-md bg-red-500/10 border-2 border-red-500/50">
                    <div className="text-xs text-red-400 mb-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> STOP LOSS
                    </div>
                    <div className="text-xl font-mono font-bold text-red-500" data-testid="text-stop-loss">
                      {latestSuggestion.stopLoss ? formatPrice(latestSuggestion.stopLoss, symbol) : '-'}
                    </div>
                  </div>
                  
                  {/* Take Profit 1 */}
                  <div className="p-3 rounded-md bg-green-500/10 border-2 border-green-500/30">
                    <div className="text-xs text-green-400 mb-1">TP1 (1R)</div>
                    <div className="text-xl font-mono font-bold text-green-500" data-testid="text-tp1">
                      {latestSuggestion.takeProfit1 ? formatPrice(latestSuggestion.takeProfit1, symbol) : '-'}
                    </div>
                  </div>
                  
                  {/* Take Profit 2 */}
                  <div className="p-3 rounded-md bg-green-500/10 border-2 border-green-500/50">
                    <div className="text-xs text-green-400 mb-1">TP2 (2R) - Target</div>
                    <div className="text-xl font-mono font-bold text-green-500" data-testid="text-tp2">
                      {latestSuggestion.takeProfit2 ? formatPrice(latestSuggestion.takeProfit2, symbol) : '-'}
                    </div>
                  </div>
                </div>
                
                {/* Support/Resistance Levels */}
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="p-2 rounded bg-background/50">
                    <div className="text-xs text-muted-foreground">Support Level</div>
                    <div className="font-mono text-sm" data-testid="text-support">
                      {latestSuggestion.supportLevel ? formatPrice(latestSuggestion.supportLevel, symbol) : '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-background/50">
                    <div className="text-xs text-muted-foreground">Resistance Level</div>
                    <div className="font-mono text-sm" data-testid="text-resistance">
                      {latestSuggestion.resistanceLevel ? formatPrice(latestSuggestion.resistanceLevel, symbol) : '-'}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-background/50">
                    <div className="text-xs text-muted-foreground">TP3 (Extended)</div>
                    <div className="font-mono text-sm text-green-400" data-testid="text-tp3">
                      {latestSuggestion.takeProfit3 ? formatPrice(latestSuggestion.takeProfit3, symbol) : '-'}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* HOLD Signal Display */}
            {latestSuggestion.decision === "HOLD" && (
              <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border-2 border-yellow-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <Minus className="h-5 w-5 text-yellow-500" />
                  <span className="font-bold text-lg text-yellow-500">No Trade Signal</span>
                </div>
                <p className="text-muted-foreground">
                  Market conditions are unclear. Wait for a stronger BUY or SELL signal before entering a position.
                  Support: {latestSuggestion.supportLevel ? formatPrice(latestSuggestion.supportLevel, symbol) : latestSuggestion.buyTarget ? formatPrice(latestSuggestion.buyTarget, symbol) : '-'} | 
                  Resistance: {latestSuggestion.resistanceLevel ? formatPrice(latestSuggestion.resistanceLevel, symbol) : latestSuggestion.sellTarget ? formatPrice(latestSuggestion.sellTarget, symbol) : '-'}
                </p>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Current Price</div>
                <div className="text-2xl font-mono font-bold" data-testid="text-current-price">
                  {formatPrice(latestSuggestion.currentPrice, symbol)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <Target className="h-3 w-3" /> Buy Target
                </div>
                <div className="text-2xl font-mono font-bold text-green-500" data-testid="text-buy-target">
                  {latestSuggestion.buyTarget ? formatPrice(latestSuggestion.buyTarget, symbol) : '-'}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <Target className="h-3 w-3" /> Sell Target
                </div>
                <div className="text-2xl font-mono font-bold text-red-500" data-testid="text-sell-target">
                  {latestSuggestion.sellTarget ? formatPrice(latestSuggestion.sellTarget, symbol) : '-'}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm font-medium mb-3">Analysis Breakdown</div>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {(() => {
                  // Filter to show only one candlestick pattern (the latest)
                  const patternReasons = latestSuggestion.reasoning.filter(r => r.indicator === "Candlestick Patterns");
                  const nonPatternReasons = latestSuggestion.reasoning.filter(r => r.indicator !== "Candlestick Patterns");
                  const latestPatternReason = patternReasons.length > 0 ? patternReasons[patternReasons.length - 1] : null;
                  const displayReasons = latestPatternReason 
                    ? [...nonPatternReasons, latestPatternReason]
                    : nonPatternReasons;
                  
                  return displayReasons.map((reason, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 rounded-md bg-background/50">
                      <Badge variant={getSignalBadgeVariant(reason.signal)} className="capitalize">
                        {reason.signal}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{reason.indicator}</div>
                        <div className="text-xs text-muted-foreground truncate">{reason.description}</div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm font-medium mb-3">Technical Indicators</div>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="p-3 rounded-md bg-background/50">
                  <div className="text-xs text-muted-foreground">EMA 12/26</div>
                  <div className="text-sm font-mono">
                    {latestSuggestion.indicators.ema12.toFixed(2)} / {latestSuggestion.indicators.ema26.toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded-md bg-background/50">
                  <div className="text-xs text-muted-foreground">RSI (14)</div>
                  <div className="text-sm font-mono">{latestSuggestion.indicators.rsi14.toFixed(1)}</div>
                </div>
                <div className="p-3 rounded-md bg-background/50">
                  <div className="text-xs text-muted-foreground">MACD</div>
                  <div className="text-sm font-mono">{latestSuggestion.indicators.macdHistogram.toFixed(3)}</div>
                </div>
                <div className="p-3 rounded-md bg-background/50">
                  <div className="text-xs text-muted-foreground">Stochastic %K</div>
                  <div className="text-sm font-mono">{latestSuggestion.indicators.stochK.toFixed(1)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!latestSuggestion && !isLoadingLatest && (
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Suggestions Yet</h3>
            <p className="text-muted-foreground">
              AI suggestions will appear here once the system has enough market data to analyze.
              Check back in about a minute.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CandlestickChart
            data={candleData || []}
            isLoading={isLoadingCandles}
            symbol={symbol}
            timeframe={chartTimeframe}
            onTimeframeChange={() => {}}
            height={400}
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CandlestickIcon className="h-5 w-5" />
              Candlestick Patterns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {patternData && patternData.isRealPattern ? (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground mb-4">
                  Current Trend: <Badge variant="outline" className="ml-2 capitalize">{patternData.trend}</Badge>
                </div>
                <div 
                  className={`p-4 rounded-lg border ${
                    patternData.patternType === "bullish" 
                      ? "bg-green-500/10 border-green-500/30" 
                      : patternData.patternType === "bearish"
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-yellow-500/10 border-yellow-500/30"
                  }`}
                  data-testid={`pattern-${patternData.patternName.toLowerCase().replace(/\s+/g, '-')}-latest`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-lg font-semibold ${
                      patternData.patternType === "bullish" ? "text-green-500" 
                      : patternData.patternType === "bearish" ? "text-red-500" 
                      : "text-yellow-500"
                    }`}>
                      {patternData.patternName}
                    </span>
                    <Badge 
                      variant={patternData.patternType === "bullish" ? "default" : patternData.patternType === "bearish" ? "destructive" : "secondary"}
                    >
                      {patternData.patternType}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{patternData.patternDescription}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Strength:</span>
                    {[...Array(5)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-3 h-3 rounded-full ${
                          i < patternData.patternStrength 
                            ? patternData.patternType === "bullish" ? "bg-green-500" 
                              : patternData.patternType === "bearish" ? "bg-red-500" 
                              : "bg-yellow-500"
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No significant patterns detected</p>
                <p className="text-xs mt-1">Patterns are scanned from last 5 minutes</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Buy Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500" data-testid="text-buy-accuracy">
              {(accuracyStats?.buyAccuracy || 0).toFixed(1)}%
            </div>
            <Progress value={accuracyStats?.buyAccuracy || 0} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Sell Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500" data-testid="text-sell-accuracy">
              {(accuracyStats?.sellAccuracy || 0).toFixed(1)}%
            </div>
            <Progress value={accuracyStats?.sellAccuracy || 0} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Minus className="h-4 w-4 text-yellow-500" />
              Hold Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-500" data-testid="text-hold-accuracy">
              {(accuracyStats?.holdAccuracy || 0).toFixed(1)}%
            </div>
            <Progress value={accuracyStats?.holdAccuracy || 0} className="mt-2 h-2" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Suggestions History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingRecent ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : recentSuggestions && recentSuggestions.length > 0 ? (
            <div className="space-y-2">
              {recentSuggestions.slice(-20).reverse().map((suggestion) => (
                <div 
                  key={suggestion.id} 
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50 hover-elevate"
                  data-testid={`row-suggestion-${suggestion.id}`}
                >
                  <div className="flex items-center gap-4">
                    <Badge 
                      variant={suggestion.decision === "BUY" ? "default" : suggestion.decision === "SELL" ? "destructive" : "secondary"}
                      className="w-16 justify-center"
                    >
                      {suggestion.decision}
                    </Badge>
                    <div>
                      <div className="text-sm font-mono">
                        ${suggestion.currentPrice.toFixed(2)}
                        {suggestion.buyTarget && (
                          <span className="text-green-500 ml-2">Buy: ${suggestion.buyTarget.toFixed(2)}</span>
                        )}
                        {suggestion.sellTarget && (
                          <span className="text-red-500 ml-2">Sell: ${suggestion.sellTarget.toFixed(2)}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(suggestion.generatedAt), "MMM d, HH:mm:ss")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm">{suggestion.confidence}% confidence</div>
                      {suggestion.isEvaluated && (
                        <div className={`text-xs ${suggestion.wasAccurate ? 'text-green-500' : 'text-red-500'}`}>
                          {suggestion.wasAccurate ? (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Accurate ({suggestion.profitLoss?.toFixed(2)}%)
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <XCircle className="h-3 w-3" />
                              Inaccurate ({suggestion.profitLoss?.toFixed(2)}%)
                            </span>
                          )}
                        </div>
                      )}
                      {!suggestion.isEvaluated && (
                        <div className="text-xs text-muted-foreground">Pending evaluation</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No suggestion history yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
