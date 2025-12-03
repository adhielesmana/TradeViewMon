import type { MarketData, InsertAiSuggestion } from "@shared/schema";
import { generateUnifiedSignal } from "./unified-signal-generator";

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
  candlestickPatterns: CandlestickPattern[];
}

interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: number;
  description: string;
}

interface SuggestionReason {
  indicator: string;
  signal: "bullish" | "bearish" | "neutral";
  description: string;
  weight: number;
}

export interface AiSuggestionResult {
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  buyTarget: number | null;
  sellTarget: number | null;
  currentPrice: number;
  reasoning: SuggestionReason[];
  indicators: TechnicalIndicators;
}

export function generateAiSuggestion(candles: MarketData[], symbol: string): AiSuggestionResult {
  const unifiedResult = generateUnifiedSignal(candles);
  
  const indicators: TechnicalIndicators = {
    ema12: unifiedResult.indicators.ema12,
    ema26: unifiedResult.indicators.ema26,
    rsi14: unifiedResult.indicators.rsi14,
    macdLine: unifiedResult.indicators.macdLine,
    macdSignal: unifiedResult.indicators.macdSignal,
    macdHistogram: unifiedResult.indicators.macdHistogram,
    stochK: unifiedResult.indicators.stochK,
    stochD: unifiedResult.indicators.stochD,
    atr: unifiedResult.indicators.atr,
    currentPrice: unifiedResult.indicators.currentPrice,
    candlestickPatterns: unifiedResult.indicators.candlestickPatterns.map(p => ({
      name: p.name,
      type: p.type,
      strength: p.strength,
      description: p.description,
    })),
  };
  
  const reasons: SuggestionReason[] = unifiedResult.reasons.map(r => ({
    indicator: r.indicator,
    signal: r.signal,
    description: r.description,
    weight: r.weight,
  }));
  
  return {
    decision: unifiedResult.decision,
    confidence: unifiedResult.confidence,
    buyTarget: unifiedResult.targets.buyTarget,
    sellTarget: unifiedResult.targets.sellTarget,
    currentPrice: unifiedResult.indicators.currentPrice,
    reasoning: reasons,
    indicators,
  };
}

export function toInsertSuggestion(result: AiSuggestionResult, symbol: string): InsertAiSuggestion {
  return {
    symbol,
    generatedAt: new Date(),
    decision: result.decision,
    confidence: result.confidence,
    buyTarget: result.buyTarget,
    sellTarget: result.sellTarget,
    currentPrice: result.currentPrice,
    reasoning: JSON.stringify(result.reasoning),
    indicators: JSON.stringify(result.indicators),
    isEvaluated: false,
  };
}

export function evaluateSuggestion(
  suggestion: { decision: string; currentPrice: number; buyTarget: number | null; sellTarget: number | null },
  actualPrice: number
): { wasAccurate: boolean; profitLoss: number } {
  const priceChange = ((actualPrice - suggestion.currentPrice) / suggestion.currentPrice) * 100;
  
  let wasAccurate = false;
  let profitLoss = 0;
  
  switch (suggestion.decision) {
    case "BUY":
      wasAccurate = priceChange > 0;
      profitLoss = priceChange;
      break;
    case "SELL":
      wasAccurate = priceChange < 0;
      profitLoss = -priceChange;
      break;
    case "HOLD":
      wasAccurate = Math.abs(priceChange) < 1;
      profitLoss = 0;
      break;
  }
  
  return { wasAccurate, profitLoss };
}
