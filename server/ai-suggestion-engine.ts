import type { MarketData, InsertAiSuggestion } from "@shared/schema";

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

// Calculate EMA
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

// Calculate RSI
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate Stochastic
function calculateStochastic(candles: MarketData[], period: number = 14): { k: number; d: number } {
  if (candles.length < period) return { k: 50, d: 50 };
  
  const recentCandles = candles.slice(-period);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const currentClose = candles[candles.length - 1].close;
  
  const k = highestHigh === lowestLow ? 50 : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  
  // Calculate %D as 3-period SMA of %K (simplified)
  const d = k; // For simplicity, using same value
  
  return { k, d };
}

// Calculate ATR (Average True Range)
function calculateATR(candles: MarketData[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  
  let trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1]?.close || candles[i].open;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trSum += tr;
  }
  
  return trSum / period;
}

// Calculate all technical indicators
function calculateIndicators(candles: MarketData[]): TechnicalIndicators {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1] || 0;
  
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const rsi14 = calculateRSI(closes, 14);
  
  const macdLine = ema12 - ema26;
  const signalPeriod = 9;
  const macdValues: number[] = [];
  
  // Calculate MACD line history for signal
  for (let i = 26; i < closes.length; i++) {
    const shortEMA = calculateEMA(closes.slice(0, i + 1), 12);
    const longEMA = calculateEMA(closes.slice(0, i + 1), 26);
    macdValues.push(shortEMA - longEMA);
  }
  
  const macdSignal = macdValues.length >= signalPeriod 
    ? calculateEMA(macdValues, signalPeriod) 
    : macdLine;
  const macdHistogram = macdLine - macdSignal;
  
  const stoch = calculateStochastic(candles, 14);
  const atr = calculateATR(candles, 14);
  
  return {
    ema12,
    ema26,
    rsi14,
    macdLine,
    macdSignal,
    macdHistogram,
    stochK: stoch.k,
    stochD: stoch.d,
    atr,
    currentPrice,
  };
}

// Generate AI suggestion based on technical indicators
export function generateAiSuggestion(candles: MarketData[], symbol: string): AiSuggestionResult {
  if (candles.length < 30) {
    const currentPrice = candles[candles.length - 1]?.close || 0;
    return {
      decision: "HOLD",
      confidence: 0,
      buyTarget: null,
      sellTarget: null,
      currentPrice,
      reasoning: [{ indicator: "Data", signal: "neutral", description: "Insufficient data for analysis", weight: 0 }],
      indicators: {
        ema12: currentPrice,
        ema26: currentPrice,
        rsi14: 50,
        macdLine: 0,
        macdSignal: 0,
        macdHistogram: 0,
        stochK: 50,
        stochD: 50,
        atr: 0,
        currentPrice,
      },
    };
  }
  
  const indicators = calculateIndicators(candles);
  const reasons: SuggestionReason[] = [];
  let bullishScore = 0;
  let bearishScore = 0;
  
  // 1. EMA Crossover Analysis (weight: 25)
  const emaDiff = ((indicators.ema12 - indicators.ema26) / indicators.ema26) * 100;
  if (emaDiff > 0.1) {
    reasons.push({
      indicator: "EMA Crossover",
      signal: "bullish",
      description: `EMA12 (${indicators.ema12.toFixed(2)}) above EMA26 (${indicators.ema26.toFixed(2)})`,
      weight: 25,
    });
    bullishScore += 25;
  } else if (emaDiff < -0.1) {
    reasons.push({
      indicator: "EMA Crossover",
      signal: "bearish",
      description: `EMA12 (${indicators.ema12.toFixed(2)}) below EMA26 (${indicators.ema26.toFixed(2)})`,
      weight: 25,
    });
    bearishScore += 25;
  } else {
    reasons.push({
      indicator: "EMA Crossover",
      signal: "neutral",
      description: "EMA12 and EMA26 are converging",
      weight: 10,
    });
  }
  
  // 2. RSI Analysis (weight: 20)
  if (indicators.rsi14 < 30) {
    reasons.push({
      indicator: "RSI",
      signal: "bullish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) indicates oversold conditions`,
      weight: 20,
    });
    bullishScore += 20;
  } else if (indicators.rsi14 > 70) {
    reasons.push({
      indicator: "RSI",
      signal: "bearish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) indicates overbought conditions`,
      weight: 20,
    });
    bearishScore += 20;
  } else if (indicators.rsi14 < 45) {
    reasons.push({
      indicator: "RSI",
      signal: "bullish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) showing potential upward momentum`,
      weight: 10,
    });
    bullishScore += 10;
  } else if (indicators.rsi14 > 55) {
    reasons.push({
      indicator: "RSI",
      signal: "bearish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) showing potential downward pressure`,
      weight: 10,
    });
    bearishScore += 10;
  } else {
    reasons.push({
      indicator: "RSI",
      signal: "neutral",
      description: `RSI (${indicators.rsi14.toFixed(1)}) in neutral zone`,
      weight: 5,
    });
  }
  
  // 3. MACD Analysis (weight: 25)
  if (indicators.macdHistogram > 0 && indicators.macdLine > 0) {
    reasons.push({
      indicator: "MACD",
      signal: "bullish",
      description: `MACD histogram positive (${indicators.macdHistogram.toFixed(3)}), bullish momentum`,
      weight: 25,
    });
    bullishScore += 25;
  } else if (indicators.macdHistogram < 0 && indicators.macdLine < 0) {
    reasons.push({
      indicator: "MACD",
      signal: "bearish",
      description: `MACD histogram negative (${indicators.macdHistogram.toFixed(3)}), bearish momentum`,
      weight: 25,
    });
    bearishScore += 25;
  } else if (indicators.macdHistogram > 0) {
    reasons.push({
      indicator: "MACD",
      signal: "bullish",
      description: `MACD histogram turning positive`,
      weight: 15,
    });
    bullishScore += 15;
  } else {
    reasons.push({
      indicator: "MACD",
      signal: "bearish",
      description: `MACD histogram turning negative`,
      weight: 15,
    });
    bearishScore += 15;
  }
  
  // 4. Stochastic Analysis (weight: 15)
  if (indicators.stochK < 20) {
    reasons.push({
      indicator: "Stochastic",
      signal: "bullish",
      description: `Stochastic %K (${indicators.stochK.toFixed(1)}) in oversold territory`,
      weight: 15,
    });
    bullishScore += 15;
  } else if (indicators.stochK > 80) {
    reasons.push({
      indicator: "Stochastic",
      signal: "bearish",
      description: `Stochastic %K (${indicators.stochK.toFixed(1)}) in overbought territory`,
      weight: 15,
    });
    bearishScore += 15;
  } else {
    reasons.push({
      indicator: "Stochastic",
      signal: "neutral",
      description: `Stochastic %K (${indicators.stochK.toFixed(1)}) in neutral range`,
      weight: 5,
    });
  }
  
  // 5. Price Trend Analysis (weight: 15)
  const recentCandles = candles.slice(-10);
  const priceChange = ((recentCandles[recentCandles.length - 1].close - recentCandles[0].close) / recentCandles[0].close) * 100;
  
  if (priceChange > 0.5) {
    reasons.push({
      indicator: "Price Trend",
      signal: "bullish",
      description: `Price up ${priceChange.toFixed(2)}% in recent period`,
      weight: 15,
    });
    bullishScore += 15;
  } else if (priceChange < -0.5) {
    reasons.push({
      indicator: "Price Trend",
      signal: "bearish",
      description: `Price down ${Math.abs(priceChange).toFixed(2)}% in recent period`,
      weight: 15,
    });
    bearishScore += 15;
  } else {
    reasons.push({
      indicator: "Price Trend",
      signal: "neutral",
      description: `Price relatively stable (${priceChange.toFixed(2)}%)`,
      weight: 5,
    });
  }
  
  // Calculate final decision
  const totalScore = bullishScore + bearishScore;
  const netScore = bullishScore - bearishScore;
  const confidence = totalScore > 0 ? Math.min(Math.abs(netScore) / totalScore * 100, 95) : 0;
  
  let decision: "BUY" | "SELL" | "HOLD";
  if (netScore > 20) {
    decision = "BUY";
  } else if (netScore < -20) {
    decision = "SELL";
  } else {
    decision = "HOLD";
  }
  
  // Calculate targets using ATR
  const atrMultiplier = 1.5;
  let buyTarget: number | null = null;
  let sellTarget: number | null = null;
  
  if (decision === "BUY") {
    buyTarget = indicators.currentPrice; // Entry point
    sellTarget = indicators.currentPrice + (indicators.atr * atrMultiplier * 2); // Take profit
  } else if (decision === "SELL") {
    sellTarget = indicators.currentPrice; // Entry point for short
    buyTarget = indicators.currentPrice - (indicators.atr * atrMultiplier * 2); // Take profit for short
  } else {
    // For HOLD, suggest potential entry/exit levels
    buyTarget = indicators.currentPrice - (indicators.atr * atrMultiplier);
    sellTarget = indicators.currentPrice + (indicators.atr * atrMultiplier);
  }
  
  return {
    decision,
    confidence: Math.round(confidence * 10) / 10,
    buyTarget: buyTarget ? Math.round(buyTarget * 100) / 100 : null,
    sellTarget: sellTarget ? Math.round(sellTarget * 100) / 100 : null,
    currentPrice: indicators.currentPrice,
    reasoning: reasons,
    indicators,
  };
}

// Convert suggestion result to database insert format
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

// Evaluate a suggestion against actual price movement
export function evaluateSuggestion(
  suggestion: { decision: string; currentPrice: number; buyTarget: number | null; sellTarget: number | null },
  actualPrice: number
): { wasAccurate: boolean; profitLoss: number } {
  const priceChange = ((actualPrice - suggestion.currentPrice) / suggestion.currentPrice) * 100;
  
  let wasAccurate = false;
  let profitLoss = 0;
  
  switch (suggestion.decision) {
    case "BUY":
      // Buy is accurate if price went up
      wasAccurate = priceChange > 0;
      profitLoss = priceChange;
      break;
    case "SELL":
      // Sell is accurate if price went down
      wasAccurate = priceChange < 0;
      profitLoss = -priceChange; // Profit from short
      break;
    case "HOLD":
      // Hold is accurate if price stayed relatively stable (within 1%)
      wasAccurate = Math.abs(priceChange) < 1;
      profitLoss = 0;
      break;
  }
  
  return { wasAccurate, profitLoss };
}
