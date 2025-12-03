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
  candlestickPatterns: CandlestickPattern[];
}

interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: number; // 1-3 (weak, moderate, strong)
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

// ==================== CANDLESTICK PATTERN ANALYSIS ====================

// Helper: Calculate candle body and wick sizes
function getCandleMetrics(candle: MarketData) {
  const body = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const isBullish = candle.close > candle.open;
  const isBearish = candle.close < candle.open;
  
  return { body, totalRange, upperWick, lowerWick, isBullish, isBearish };
}

// Helper: Detect trend direction (uptrend, downtrend, or sideways)
function detectTrend(candles: MarketData[], lookback: number = 10): "uptrend" | "downtrend" | "sideways" {
  if (candles.length < lookback) return "sideways";
  
  const recentCandles = candles.slice(-lookback);
  const firstPrice = recentCandles[0].close;
  const lastPrice = recentCandles[recentCandles.length - 1].close;
  const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  
  // Count higher highs and lower lows
  let higherHighs = 0;
  let lowerLows = 0;
  
  for (let i = 1; i < recentCandles.length; i++) {
    if (recentCandles[i].high > recentCandles[i - 1].high) higherHighs++;
    if (recentCandles[i].low < recentCandles[i - 1].low) lowerLows++;
  }
  
  if (priceChange > 0.5 && higherHighs > lowerLows) return "uptrend";
  if (priceChange < -0.5 && lowerLows > higherHighs) return "downtrend";
  return "sideways";
}

// Pattern: Hammer (Bullish Reversal) - appears after downtrend
function detectHammer(candle: MarketData, trend: string): CandlestickPattern | null {
  const { body, totalRange, upperWick, lowerWick, isBullish } = getCandleMetrics(candle);
  
  if (totalRange === 0) return null;
  
  // Hammer: small body at top, long lower wick (2x+ body), small upper wick
  const bodyRatio = body / totalRange;
  const lowerWickRatio = lowerWick / totalRange;
  const upperWickRatio = upperWick / totalRange;
  
  if (bodyRatio < 0.35 && lowerWickRatio > 0.5 && upperWickRatio < 0.15) {
    // Only valid in downtrend or sideways (potential reversal)
    if (trend === "downtrend" || trend === "sideways") {
      return {
        name: "Hammer",
        type: "bullish",
        strength: trend === "downtrend" ? 3 : 2,
        description: "Hammer pattern detected - sellers pushed price down but buyers recovered, signaling potential bullish reversal"
      };
    }
  }
  return null;
}

// Pattern: Hanging Man (Bearish Reversal) - appears after uptrend
function detectHangingMan(candle: MarketData, trend: string): CandlestickPattern | null {
  const { body, totalRange, upperWick, lowerWick } = getCandleMetrics(candle);
  
  if (totalRange === 0) return null;
  
  // Same shape as hammer but appears after uptrend
  const bodyRatio = body / totalRange;
  const lowerWickRatio = lowerWick / totalRange;
  const upperWickRatio = upperWick / totalRange;
  
  if (bodyRatio < 0.35 && lowerWickRatio > 0.5 && upperWickRatio < 0.15) {
    if (trend === "uptrend") {
      return {
        name: "Hanging Man",
        type: "bearish",
        strength: 2,
        description: "Hanging Man pattern detected - buying momentum may be weakening, caution advised"
      };
    }
  }
  return null;
}

// Pattern: Shooting Star (Bearish Reversal) - appears after uptrend
function detectShootingStar(candle: MarketData, trend: string): CandlestickPattern | null {
  const { body, totalRange, upperWick, lowerWick } = getCandleMetrics(candle);
  
  if (totalRange === 0) return null;
  
  // Shooting Star: small body at bottom, long upper wick (2x+ body), small lower wick
  const bodyRatio = body / totalRange;
  const upperWickRatio = upperWick / totalRange;
  const lowerWickRatio = lowerWick / totalRange;
  
  if (bodyRatio < 0.35 && upperWickRatio > 0.5 && lowerWickRatio < 0.15) {
    if (trend === "uptrend" || trend === "sideways") {
      return {
        name: "Shooting Star",
        type: "bearish",
        strength: trend === "uptrend" ? 3 : 2,
        description: "Shooting Star pattern detected - buyers attempted higher prices but were rejected, potential drop ahead"
      };
    }
  }
  return null;
}

// Pattern: Doji (Indecision)
function detectDoji(candle: MarketData): CandlestickPattern | null {
  const { body, totalRange } = getCandleMetrics(candle);
  
  if (totalRange === 0) return null;
  
  // Doji: very small body (open ≈ close)
  const bodyRatio = body / totalRange;
  
  if (bodyRatio < 0.1) {
    return {
      name: "Doji",
      type: "neutral",
      strength: 2,
      description: "Doji pattern detected - market indecision, bulls and bears in equilibrium, often precedes a major move"
    };
  }
  return null;
}

// Pattern: Bullish Engulfing (Bullish Reversal)
function detectBullishEngulfing(candles: MarketData[], trend: string): CandlestickPattern | null {
  if (candles.length < 2) return null;
  
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  
  const prevMetrics = getCandleMetrics(prev);
  const currMetrics = getCandleMetrics(curr);
  
  // Bullish Engulfing: previous is bearish, current is bullish and completely engulfs previous body
  if (prevMetrics.isBearish && currMetrics.isBullish) {
    if (curr.open < prev.close && curr.close > prev.open) {
      // Current candle's body engulfs previous candle's body
      if (currMetrics.body > prevMetrics.body * 1.2) {
        if (trend === "downtrend" || trend === "sideways") {
          return {
            name: "Bullish Engulfing",
            type: "bullish",
            strength: 3,
            description: "Bullish Engulfing pattern - buyers have overpowered sellers, strong potential upward reversal"
          };
        }
      }
    }
  }
  return null;
}

// Pattern: Bearish Engulfing (Bearish Reversal)
function detectBearishEngulfing(candles: MarketData[], trend: string): CandlestickPattern | null {
  if (candles.length < 2) return null;
  
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  
  const prevMetrics = getCandleMetrics(prev);
  const currMetrics = getCandleMetrics(curr);
  
  // Bearish Engulfing: previous is bullish, current is bearish and completely engulfs previous body
  if (prevMetrics.isBullish && currMetrics.isBearish) {
    if (curr.open > prev.close && curr.close < prev.open) {
      if (currMetrics.body > prevMetrics.body * 1.2) {
        if (trend === "uptrend" || trend === "sideways") {
          return {
            name: "Bearish Engulfing",
            type: "bearish",
            strength: 3,
            description: "Bearish Engulfing pattern - sellers have taken control, strong potential downward reversal"
          };
        }
      }
    }
  }
  return null;
}

// Pattern: Morning Star (Bullish Reversal) - 3 candle pattern
function detectMorningStar(candles: MarketData[], trend: string): CandlestickPattern | null {
  if (candles.length < 3) return null;
  
  const first = candles[candles.length - 3];
  const middle = candles[candles.length - 2];
  const last = candles[candles.length - 1];
  
  const firstMetrics = getCandleMetrics(first);
  const middleMetrics = getCandleMetrics(middle);
  const lastMetrics = getCandleMetrics(last);
  
  // Morning Star: large bearish -> small body (indecision) -> large bullish
  if (firstMetrics.isBearish && firstMetrics.body > middleMetrics.body * 2) {
    if (middleMetrics.body / middleMetrics.totalRange < 0.3) {  // Small body (indecision)
      if (lastMetrics.isBullish && lastMetrics.body > middleMetrics.body * 2) {
        // Last candle closes above midpoint of first candle
        const firstMidpoint = (first.open + first.close) / 2;
        if (last.close > firstMidpoint) {
          if (trend === "downtrend" || trend === "sideways") {
            return {
              name: "Morning Star",
              type: "bullish",
              strength: 3,
              description: "Morning Star pattern - strong bullish reversal signal, bearish trend likely ending"
            };
          }
        }
      }
    }
  }
  return null;
}

// Pattern: Evening Star (Bearish Reversal) - 3 candle pattern
function detectEveningStar(candles: MarketData[], trend: string): CandlestickPattern | null {
  if (candles.length < 3) return null;
  
  const first = candles[candles.length - 3];
  const middle = candles[candles.length - 2];
  const last = candles[candles.length - 1];
  
  const firstMetrics = getCandleMetrics(first);
  const middleMetrics = getCandleMetrics(middle);
  const lastMetrics = getCandleMetrics(last);
  
  // Evening Star: large bullish -> small body (indecision) -> large bearish
  if (firstMetrics.isBullish && firstMetrics.body > middleMetrics.body * 2) {
    if (middleMetrics.body / middleMetrics.totalRange < 0.3) {  // Small body (indecision)
      if (lastMetrics.isBearish && lastMetrics.body > middleMetrics.body * 2) {
        // Last candle closes below midpoint of first candle
        const firstMidpoint = (first.open + first.close) / 2;
        if (last.close < firstMidpoint) {
          if (trend === "uptrend" || trend === "sideways") {
            return {
              name: "Evening Star",
              type: "bearish",
              strength: 3,
              description: "Evening Star pattern - strong bearish reversal signal, bullish trend likely ending"
            };
          }
        }
      }
    }
  }
  return null;
}

// Pattern: Three White Soldiers (Bullish Continuation/Reversal)
function detectThreeWhiteSoldiers(candles: MarketData[]): CandlestickPattern | null {
  if (candles.length < 3) return null;
  
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  
  const m1 = getCandleMetrics(c1);
  const m2 = getCandleMetrics(c2);
  const m3 = getCandleMetrics(c3);
  
  // Three consecutive bullish candles, each closing higher with minimal wicks
  if (m1.isBullish && m2.isBullish && m3.isBullish) {
    if (c2.close > c1.close && c3.close > c2.close) {
      if (c2.open > c1.open && c3.open > c2.open) {
        // Minimal upper wicks
        const avgWickRatio = (m1.upperWick / m1.totalRange + m2.upperWick / m2.totalRange + m3.upperWick / m3.totalRange) / 3;
        if (avgWickRatio < 0.3) {
          return {
            name: "Three White Soldiers",
            type: "bullish",
            strength: 3,
            description: "Three White Soldiers - strong bullish momentum, buyers in full control"
          };
        }
      }
    }
  }
  return null;
}

// Pattern: Three Black Crows (Bearish Continuation/Reversal)
function detectThreeBlackCrows(candles: MarketData[]): CandlestickPattern | null {
  if (candles.length < 3) return null;
  
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  
  const m1 = getCandleMetrics(c1);
  const m2 = getCandleMetrics(c2);
  const m3 = getCandleMetrics(c3);
  
  // Three consecutive bearish candles, each closing lower with minimal wicks
  if (m1.isBearish && m2.isBearish && m3.isBearish) {
    if (c2.close < c1.close && c3.close < c2.close) {
      if (c2.open < c1.open && c3.open < c2.open) {
        // Minimal lower wicks
        const avgWickRatio = (m1.lowerWick / m1.totalRange + m2.lowerWick / m2.totalRange + m3.lowerWick / m3.totalRange) / 3;
        if (avgWickRatio < 0.3) {
          return {
            name: "Three Black Crows",
            type: "bearish",
            strength: 3,
            description: "Three Black Crows - strong bearish momentum, sellers in full control"
          };
        }
      }
    }
  }
  return null;
}

// Detect all candlestick patterns
function detectCandlestickPatterns(candles: MarketData[]): CandlestickPattern[] {
  if (candles.length < 3) return [];
  
  const patterns: CandlestickPattern[] = [];
  const trend = detectTrend(candles, 10);
  const currentCandle = candles[candles.length - 1];
  
  // Single candle patterns
  const hammer = detectHammer(currentCandle, trend);
  if (hammer) patterns.push(hammer);
  
  const hangingMan = detectHangingMan(currentCandle, trend);
  if (hangingMan) patterns.push(hangingMan);
  
  const shootingStar = detectShootingStar(currentCandle, trend);
  if (shootingStar) patterns.push(shootingStar);
  
  const doji = detectDoji(currentCandle);
  if (doji) patterns.push(doji);
  
  // Two candle patterns
  const bullishEngulfing = detectBullishEngulfing(candles, trend);
  if (bullishEngulfing) patterns.push(bullishEngulfing);
  
  const bearishEngulfing = detectBearishEngulfing(candles, trend);
  if (bearishEngulfing) patterns.push(bearishEngulfing);
  
  // Three candle patterns
  const morningStar = detectMorningStar(candles, trend);
  if (morningStar) patterns.push(morningStar);
  
  const eveningStar = detectEveningStar(candles, trend);
  if (eveningStar) patterns.push(eveningStar);
  
  const threeWhiteSoldiers = detectThreeWhiteSoldiers(candles);
  if (threeWhiteSoldiers) patterns.push(threeWhiteSoldiers);
  
  const threeBlackCrows = detectThreeBlackCrows(candles);
  if (threeBlackCrows) patterns.push(threeBlackCrows);
  
  return patterns;
}

// ==================== END CANDLESTICK PATTERN ANALYSIS ====================

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
  
  // Detect candlestick patterns
  const candlestickPatterns = detectCandlestickPatterns(candles);
  
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
    candlestickPatterns,
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
        candlestickPatterns: [],
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
  
  // 6. Candlestick Pattern Analysis (weight: up to 25 based on pattern strength)
  const patterns = indicators.candlestickPatterns;
  if (patterns.length > 0) {
    for (const pattern of patterns) {
      // Weight calculation: strength (1-3) * base weight (8)
      const patternWeight = pattern.strength * 8;
      
      reasons.push({
        indicator: `Candlestick: ${pattern.name}`,
        signal: pattern.type,
        description: pattern.description,
        weight: patternWeight,
      });
      
      if (pattern.type === "bullish") {
        bullishScore += patternWeight;
      } else if (pattern.type === "bearish") {
        bearishScore += patternWeight;
      }
      // Neutral patterns (like Doji) contribute to indecision but don't affect scores
    }
  } else {
    reasons.push({
      indicator: "Candlestick Patterns",
      signal: "neutral",
      description: "No significant candlestick patterns detected",
      weight: 0,
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
