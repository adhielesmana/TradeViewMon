import type { MarketData } from "@shared/schema";

export interface PrecisionTradePlan {
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number; // Conservative TP (1R)
  takeProfit2: number; // Standard TP (2R)
  takeProfit3: number; // Extended TP (3R)
  riskRewardRatio: number;
  supportLevel: number;
  resistanceLevel: number;
  signalType: "immediate" | "pending";
  validUntil: Date;
  riskAmount: number; // Distance from entry to SL
  potentialReward: number; // Distance from entry to TP2
  analysis: string; // Human-readable trade rationale
}

export interface UnifiedSignalResult {
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  bullishScore: number;
  bearishScore: number;
  netScore: number;
  reasons: SignalReason[];
  indicators: TechnicalIndicatorValues;
  targets: {
    buyTarget: number | null;
    sellTarget: number | null;
  };
  tradePlan: PrecisionTradePlan | null;
}

export interface SignalReason {
  indicator: string;
  signal: "bullish" | "bearish" | "neutral";
  description: string;
  weight: number;
}

export interface TechnicalIndicatorValues {
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
  priceChange: number;
  candlestickPatterns: CandlestickPattern[];
}

export interface CandlestickPattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: number;
  description: string;
  candleIndex?: number;
  timestamp?: string;
}

const WEIGHTS = {
  EMA_CROSSOVER: 25,
  EMA_CROSSOVER_NEUTRAL: 10,
  RSI_EXTREME: 20,
  RSI_MODERATE: 10,
  RSI_NEUTRAL: 5,
  MACD_STRONG: 25,
  MACD_WEAK: 15,
  STOCHASTIC_EXTREME: 15,
  STOCHASTIC_NEUTRAL: 5,
  PRICE_TREND: 15,
  PRICE_TREND_NEUTRAL: 5,
  CANDLESTICK_BASE: 8,
};

const THRESHOLDS = {
  EMA_DIFF_PERCENT: 0.1,
  RSI_OVERSOLD: 30,
  RSI_OVERBOUGHT: 70,
  RSI_BULLISH_ZONE: 45,
  RSI_BEARISH_ZONE: 55,
  STOCH_OVERSOLD: 20,
  STOCH_OVERBOUGHT: 80,
  PRICE_TREND_THRESHOLD: 0.5,
  // Lowered from ±40 to ±25 for more actionable signals when indicators align
  // This prevents high-confidence signals from being stuck as HOLD
  BUY_THRESHOLD: 25,
  SELL_THRESHOLD: -25,
};

// Support/Resistance Detection using swing highs/lows
interface SupportResistance {
  support: number;
  resistance: number;
  supportStrength: number;
  resistanceStrength: number;
}

function detectSupportResistance(candles: MarketData[], lookback: number = 50): SupportResistance {
  if (candles.length < 10) {
    const lastClose = candles[candles.length - 1]?.close || 0;
    return {
      support: lastClose * 0.98,
      resistance: lastClose * 1.02,
      supportStrength: 1,
      resistanceStrength: 1,
    };
  }

  const recentCandles = candles.slice(-Math.min(lookback, candles.length));
  const currentPrice = recentCandles[recentCandles.length - 1].close;
  
  // Find swing highs and lows (local extremes)
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  
  for (let i = 2; i < recentCandles.length - 2; i++) {
    const prev2 = recentCandles[i - 2];
    const prev1 = recentCandles[i - 1];
    const curr = recentCandles[i];
    const next1 = recentCandles[i + 1];
    const next2 = recentCandles[i + 2];
    
    // Swing high: current high is higher than surrounding 2 candles
    if (curr.high > prev1.high && curr.high > prev2.high && 
        curr.high > next1.high && curr.high > next2.high) {
      swingHighs.push(curr.high);
    }
    
    // Swing low: current low is lower than surrounding 2 candles
    if (curr.low < prev1.low && curr.low < prev2.low && 
        curr.low < next1.low && curr.low < next2.low) {
      swingLows.push(curr.low);
    }
  }
  
  // If we don't have enough swing points, use min/max of recent data
  if (swingHighs.length === 0) {
    swingHighs.push(Math.max(...recentCandles.map(c => c.high)));
  }
  if (swingLows.length === 0) {
    swingLows.push(Math.min(...recentCandles.map(c => c.low)));
  }
  
  // Find nearest support (below current price)
  const supportsBelow = swingLows.filter(s => s < currentPrice);
  const support = supportsBelow.length > 0 
    ? Math.max(...supportsBelow) 
    : currentPrice - (currentPrice * 0.02);
  
  // Find nearest resistance (above current price)
  const resistancesAbove = swingHighs.filter(r => r > currentPrice);
  const resistance = resistancesAbove.length > 0 
    ? Math.min(...resistancesAbove) 
    : currentPrice + (currentPrice * 0.02);
  
  // Calculate strength based on how many times price has touched these levels
  const supportTouches = recentCandles.filter(c => 
    Math.abs(c.low - support) / support < 0.005
  ).length;
  const resistanceTouches = recentCandles.filter(c => 
    Math.abs(c.high - resistance) / resistance < 0.005
  ).length;
  
  return {
    support: Math.round(support * 100) / 100,
    resistance: Math.round(resistance * 100) / 100,
    supportStrength: Math.min(supportTouches + 1, 5),
    resistanceStrength: Math.min(resistanceTouches + 1, 5),
  };
}

function calculatePrecisionTradePlan(
  decision: "BUY" | "SELL" | "HOLD",
  currentPrice: number,
  atr: number,
  supportResistance: SupportResistance,
  confidence: number,
  reasons: SignalReason[]
): PrecisionTradePlan | null {
  if (decision === "HOLD") {
    return null;
  }
  
  const { support, resistance } = supportResistance;
  
  let entryPrice: number;
  let stopLoss: number;
  let takeProfit1: number;
  let takeProfit2: number;
  let takeProfit3: number;
  let riskAmount: number;
  let signalType: "immediate" | "pending" = "immediate";
  let analysis: string;
  
  if (decision === "BUY") {
    // For BUY: entry at current or slight pullback, SL below support, TP at resistance
    const distanceToSupport = currentPrice - support;
    
    // If price is near support (within 1 ATR), use immediate entry
    // Otherwise, suggest pending order at better price
    if (distanceToSupport < atr * 1.5) {
      entryPrice = currentPrice;
      signalType = "immediate";
    } else {
      // Suggest entry at a pullback level (midway to support)
      entryPrice = currentPrice - (distanceToSupport * 0.3);
      signalType = "pending";
    }
    
    // Stop loss: below support by 0.5 ATR for safety buffer
    stopLoss = support - (atr * 0.5);
    riskAmount = entryPrice - stopLoss;
    
    // Take profits based on risk multiples (ascending for BUY: TP1 < TP2 < TP3)
    takeProfit1 = entryPrice + riskAmount; // 1R (1:1 risk/reward)
    takeProfit2 = entryPrice + (riskAmount * 2); // 2R
    takeProfit3 = entryPrice + (riskAmount * 3); // 3R extended target
    
    // Ensure proper ascending sequence: TP1 < TP2 < TP3
    if (takeProfit2 <= takeProfit1) {
      takeProfit2 = takeProfit1 + (riskAmount * 0.5);
    }
    if (takeProfit3 <= takeProfit2) {
      takeProfit3 = takeProfit2 + (riskAmount * 0.5);
    }
    
    analysis = `BUY Signal: ${signalType === "immediate" ? "Enter now" : `Set buy order at $${entryPrice.toFixed(2)}`}. ` +
      `Price near support at $${support.toFixed(2)}. ` +
      `Risk $${riskAmount.toFixed(2)} per unit. ` +
      `Target resistance at $${resistance.toFixed(2)}.`;
      
  } else { // SELL
    // For SELL: entry at current or slight rally, SL above resistance, TP at support
    const distanceToResistance = resistance - currentPrice;
    
    if (distanceToResistance < atr * 1.5) {
      entryPrice = currentPrice;
      signalType = "immediate";
    } else {
      // Suggest entry at a rally level (midway to resistance)
      entryPrice = currentPrice + (distanceToResistance * 0.3);
      signalType = "pending";
    }
    
    // Stop loss: above resistance by 0.5 ATR for safety buffer
    stopLoss = resistance + (atr * 0.5);
    riskAmount = stopLoss - entryPrice;
    
    // Take profits based on risk multiples (descending for SELL: TP1 > TP2 > TP3)
    takeProfit1 = entryPrice - riskAmount; // 1R
    takeProfit2 = entryPrice - (riskAmount * 2); // 2R
    takeProfit3 = entryPrice - (riskAmount * 3); // 3R extended target
    
    // Ensure proper descending sequence: TP1 > TP2 > TP3
    if (takeProfit2 >= takeProfit1) {
      takeProfit2 = takeProfit1 - (riskAmount * 0.5);
    }
    if (takeProfit3 >= takeProfit2) {
      takeProfit3 = takeProfit2 - (riskAmount * 0.5);
    }
    
    analysis = `SELL Signal: ${signalType === "immediate" ? "Enter now" : `Set sell order at $${entryPrice.toFixed(2)}`}. ` +
      `Price near resistance at $${resistance.toFixed(2)}. ` +
      `Risk $${riskAmount.toFixed(2)} per unit. ` +
      `Target support at $${support.toFixed(2)}.`;
  }
  
  // Calculate risk/reward ratio
  const potentialReward = Math.abs(takeProfit2 - entryPrice);
  const riskRewardRatio = riskAmount > 0 ? Math.round((potentialReward / riskAmount) * 10) / 10 : 0;
  
  // Valid for 1 hour
  const validUntil = new Date(Date.now() + 60 * 60 * 1000);
  
  return {
    entryPrice: Math.round(entryPrice * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit1: Math.round(takeProfit1 * 100) / 100,
    takeProfit2: Math.round(takeProfit2 * 100) / 100,
    takeProfit3: Math.round(takeProfit3 * 100) / 100,
    riskRewardRatio,
    supportLevel: support,
    resistanceLevel: resistance,
    signalType,
    validUntil,
    riskAmount: Math.round(riskAmount * 100) / 100,
    potentialReward: Math.round(potentialReward * 100) / 100,
    analysis,
  };
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

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

function calculateStochastic(candles: MarketData[], period: number = 14): { k: number; d: number } {
  if (candles.length < period) return { k: 50, d: 50 };
  
  const recentCandles = candles.slice(-period);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const currentClose = candles[candles.length - 1].close;
  
  const k = highestHigh === lowestLow ? 50 : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  const d = k;
  
  return { k, d };
}

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

function getCandleMetrics(candle: MarketData) {
  const body = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const isBullish = candle.close > candle.open;
  const isBearish = candle.close < candle.open;
  
  return { body, totalRange, upperWick, lowerWick, isBullish, isBearish };
}

function detectTrend(candles: MarketData[], lookback: number = 10): "uptrend" | "downtrend" | "sideways" {
  if (candles.length < lookback) return "sideways";
  
  const recentCandles = candles.slice(-lookback);
  const firstPrice = recentCandles[0].close;
  const lastPrice = recentCandles[recentCandles.length - 1].close;
  const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  
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

function detectCandlestickPatterns(candles: MarketData[], maxAgeMinutes: number = 5): CandlestickPattern[] {
  if (candles.length < 3) return [];
  
  const patterns: CandlestickPattern[] = [];
  
  // Filter candles to only those within the specified time window (1-5 minutes)
  const now = Date.now();
  const cutoffTime = now - (maxAgeMinutes * 60 * 1000);
  
  // Find the index where recent candles start (within maxAgeMinutes)
  let startIndex = candles.length - 1;
  for (let i = candles.length - 1; i >= 0; i--) {
    const candleTime = candles[i].timestamp ? new Date(candles[i].timestamp).getTime() : 0;
    if (candleTime >= cutoffTime) {
      startIndex = i;
    } else {
      break;
    }
  }
  
  // Ensure we have at least 1 candle to analyze, but cap at 5 most recent
  const recentCandlesCount = candles.length - startIndex;
  const effectiveStartIndex = Math.max(startIndex, candles.length - Math.min(5, recentCandlesCount || 5));
  
  for (let i = effectiveStartIndex; i < candles.length; i++) {
    if (i < 1) continue;
    
    const localTrend = detectTrend(candles.slice(0, i + 1), 10);
    const currentCandle = candles[i];
    const { body, totalRange, upperWick, lowerWick, isBullish, isBearish } = getCandleMetrics(currentCandle);
    
    if (totalRange === 0) continue;
    
    const bodyRatio = body / totalRange;
    const lowerWickRatio = lowerWick / totalRange;
    const upperWickRatio = upperWick / totalRange;
    const timestamp = currentCandle.timestamp?.toString();
    
    if (bodyRatio < 0.40 && lowerWickRatio > 0.45 && upperWickRatio < 0.20) {
      if (localTrend === "downtrend" || localTrend === "sideways") {
        patterns.push({
          name: "Hammer",
          type: "bullish",
          strength: localTrend === "downtrend" ? 4 : 3,
          description: "Hammer pattern - potential bullish reversal with strong buying pressure",
          candleIndex: i,
          timestamp
        });
      } else if (localTrend === "uptrend") {
        patterns.push({
          name: "Hanging Man",
          type: "bearish",
          strength: 3,
          description: "Hanging Man pattern - uptrend may be losing momentum",
          candleIndex: i,
          timestamp
        });
      }
    }
    
    if (bodyRatio < 0.40 && upperWickRatio > 0.45 && lowerWickRatio < 0.20) {
      if (localTrend === "uptrend" || localTrend === "sideways") {
        patterns.push({
          name: "Shooting Star",
          type: "bearish",
          strength: localTrend === "uptrend" ? 4 : 3,
          description: "Shooting Star pattern - potential bearish reversal with selling pressure",
          candleIndex: i,
          timestamp
        });
      } else if (localTrend === "downtrend") {
        patterns.push({
          name: "Inverted Hammer",
          type: "bullish",
          strength: 3,
          description: "Inverted Hammer - potential bullish reversal",
          candleIndex: i,
          timestamp
        });
      }
    }
    
    if (bodyRatio < 0.15) {
      const dragonfly = lowerWickRatio > 0.6 && upperWickRatio < 0.1;
      const gravestone = upperWickRatio > 0.6 && lowerWickRatio < 0.1;
      
      if (dragonfly) {
        patterns.push({
          name: "Dragonfly Doji",
          type: localTrend === "downtrend" ? "bullish" : "neutral",
          strength: 3,
          description: "Dragonfly Doji - bullish reversal potential after downtrend",
          candleIndex: i,
          timestamp
        });
      } else if (gravestone) {
        patterns.push({
          name: "Gravestone Doji",
          type: localTrend === "uptrend" ? "bearish" : "neutral",
          strength: 3,
          description: "Gravestone Doji - bearish reversal potential after uptrend",
          candleIndex: i,
          timestamp
        });
      } else {
        patterns.push({
          name: "Doji",
          type: "neutral",
          strength: 2,
          description: "Doji - market indecision, watch for directional move",
          candleIndex: i,
          timestamp
        });
      }
    }
    
    if (i >= 1) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const prevMetrics = getCandleMetrics(prev);
      const currMetrics = getCandleMetrics(curr);
      
      if (prevMetrics.isBearish && currMetrics.isBullish) {
        const engulfing = curr.close > prev.open && curr.open <= prev.close;
        if (engulfing && currMetrics.body > prevMetrics.body * 1.1) {
          patterns.push({
            name: "Bullish Engulfing",
            type: "bullish",
            strength: localTrend === "downtrend" ? 5 : 4,
            description: "Bullish Engulfing - strong upward reversal signal",
            candleIndex: i,
            timestamp
          });
        }
      }
      
      if (prevMetrics.isBullish && currMetrics.isBearish) {
        const engulfing = curr.close < prev.open && curr.open >= prev.close;
        if (engulfing && currMetrics.body > prevMetrics.body * 1.1) {
          patterns.push({
            name: "Bearish Engulfing",
            type: "bearish",
            strength: localTrend === "uptrend" ? 5 : 4,
            description: "Bearish Engulfing - strong downward reversal signal",
            candleIndex: i,
            timestamp
          });
        }
      }
      
      if (currMetrics.isBullish && currMetrics.body > prevMetrics.totalRange * 2) {
        patterns.push({
          name: "Bullish Marubozu",
          type: "bullish",
          strength: 4,
          description: "Bullish Marubozu - strong buying pressure with minimal wicks",
          candleIndex: i,
          timestamp
        });
      }
      
      if (currMetrics.isBearish && currMetrics.body > prevMetrics.totalRange * 2) {
        patterns.push({
          name: "Bearish Marubozu",
          type: "bearish",
          strength: 4,
          description: "Bearish Marubozu - strong selling pressure with minimal wicks",
          candleIndex: i,
          timestamp
        });
      }
    }
    
    if (i >= 2) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];
      const m1 = getCandleMetrics(c1);
      const m2 = getCandleMetrics(c2);
      const m3 = getCandleMetrics(c3);
      
      if (m1.isBullish && m3.isBullish && m2.body / m2.totalRange < 0.3) {
        const starLower = Math.min(c2.open, c2.close) < Math.min(c1.close, c3.open);
        if (starLower && localTrend === "uptrend") {
          patterns.push({
            name: "Evening Star",
            type: "bearish",
            strength: 4,
            description: "Evening Star - three-candle bearish reversal pattern",
            candleIndex: i,
            timestamp
          });
        }
      }
      
      if (m1.isBearish && m3.isBullish && m2.body / m2.totalRange < 0.3) {
        const starHigher = Math.max(c2.open, c2.close) > Math.max(c1.close, c3.open);
        if (starHigher && localTrend === "downtrend") {
          patterns.push({
            name: "Morning Star",
            type: "bullish",
            strength: 4,
            description: "Morning Star - three-candle bullish reversal pattern",
            candleIndex: i,
            timestamp
          });
        }
      }
      
      if (m1.isBullish && m2.isBullish && m3.isBullish) {
        const rising = c1.close < c2.close && c2.close < c3.close;
        if (rising) {
          patterns.push({
            name: "Three White Soldiers",
            type: "bullish",
            strength: 5,
            description: "Three White Soldiers - strong bullish continuation",
            candleIndex: i,
            timestamp
          });
        }
      }
      
      if (m1.isBearish && m2.isBearish && m3.isBearish) {
        const falling = c1.close > c2.close && c2.close > c3.close;
        if (falling) {
          patterns.push({
            name: "Three Black Crows",
            type: "bearish",
            strength: 5,
            description: "Three Black Crows - strong bearish continuation",
            candleIndex: i,
            timestamp
          });
        }
      }
    }
  }
  
  const uniquePatterns = patterns.reduce((acc, pattern) => {
    const key = `${pattern.name}-${pattern.candleIndex}`;
    if (!acc.has(key)) {
      acc.set(key, pattern);
    }
    return acc;
  }, new Map<string, CandlestickPattern>());
  
  return Array.from(uniquePatterns.values())
    .sort((a, b) => (b.candleIndex || 0) - (a.candleIndex || 0))
    .slice(0, 10);
}

export function detectAllCandlestickPatterns(candles: MarketData[]): {
  patterns: CandlestickPattern[];
  trend: string;
} {
  const patterns = detectCandlestickPatterns(candles);
  const lookback = Math.min(Math.max(20, Math.floor(candles.length * 0.2)), 50);
  const trend = candles.length >= lookback ? detectTrend(candles, lookback) : "sideways";
  return { patterns, trend };
}

function calculateIndicators(candles: MarketData[]): TechnicalIndicatorValues {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1] || 0;
  
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const rsi14 = calculateRSI(closes, 14);
  
  const macdLine = ema12 - ema26;
  const signalPeriod = 9;
  const macdValues: number[] = [];
  
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
  
  const recentCandles = candles.slice(-10);
  const priceChange = recentCandles.length > 0 
    ? ((recentCandles[recentCandles.length - 1].close - recentCandles[0].close) / recentCandles[0].close) * 100 
    : 0;
  
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
    priceChange,
    candlestickPatterns,
  };
}

export function generateUnifiedSignal(candles: MarketData[]): UnifiedSignalResult {
  if (candles.length < 30) {
    const currentPrice = candles[candles.length - 1]?.close || 0;
    return {
      decision: "HOLD",
      confidence: 0,
      bullishScore: 0,
      bearishScore: 0,
      netScore: 0,
      reasons: [{ indicator: "Data", signal: "neutral", description: "Insufficient data for analysis", weight: 0 }],
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
        priceChange: 0,
        candlestickPatterns: [],
      },
      targets: {
        buyTarget: null,
        sellTarget: null,
      },
      tradePlan: null,
    };
  }
  
  const indicators = calculateIndicators(candles);
  const reasons: SignalReason[] = [];
  let bullishScore = 0;
  let bearishScore = 0;
  
  const emaDiff = ((indicators.ema12 - indicators.ema26) / indicators.ema26) * 100;
  if (emaDiff > THRESHOLDS.EMA_DIFF_PERCENT) {
    reasons.push({
      indicator: "EMA Crossover",
      signal: "bullish",
      description: `EMA12 (${indicators.ema12.toFixed(2)}) above EMA26 (${indicators.ema26.toFixed(2)})`,
      weight: WEIGHTS.EMA_CROSSOVER,
    });
    bullishScore += WEIGHTS.EMA_CROSSOVER;
  } else if (emaDiff < -THRESHOLDS.EMA_DIFF_PERCENT) {
    reasons.push({
      indicator: "EMA Crossover",
      signal: "bearish",
      description: `EMA12 (${indicators.ema12.toFixed(2)}) below EMA26 (${indicators.ema26.toFixed(2)})`,
      weight: WEIGHTS.EMA_CROSSOVER,
    });
    bearishScore += WEIGHTS.EMA_CROSSOVER;
  } else {
    reasons.push({
      indicator: "EMA Crossover",
      signal: "neutral",
      description: "EMA12 and EMA26 are converging",
      weight: WEIGHTS.EMA_CROSSOVER_NEUTRAL,
    });
  }
  
  if (indicators.rsi14 < THRESHOLDS.RSI_OVERSOLD) {
    reasons.push({
      indicator: "RSI",
      signal: "bullish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) indicates oversold conditions`,
      weight: WEIGHTS.RSI_EXTREME,
    });
    bullishScore += WEIGHTS.RSI_EXTREME;
  } else if (indicators.rsi14 > THRESHOLDS.RSI_OVERBOUGHT) {
    reasons.push({
      indicator: "RSI",
      signal: "bearish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) indicates overbought conditions`,
      weight: WEIGHTS.RSI_EXTREME,
    });
    bearishScore += WEIGHTS.RSI_EXTREME;
  } else if (indicators.rsi14 < THRESHOLDS.RSI_BULLISH_ZONE) {
    reasons.push({
      indicator: "RSI",
      signal: "bullish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) showing potential upward momentum`,
      weight: WEIGHTS.RSI_MODERATE,
    });
    bullishScore += WEIGHTS.RSI_MODERATE;
  } else if (indicators.rsi14 > THRESHOLDS.RSI_BEARISH_ZONE) {
    reasons.push({
      indicator: "RSI",
      signal: "bearish",
      description: `RSI (${indicators.rsi14.toFixed(1)}) showing potential downward pressure`,
      weight: WEIGHTS.RSI_MODERATE,
    });
    bearishScore += WEIGHTS.RSI_MODERATE;
  } else {
    reasons.push({
      indicator: "RSI",
      signal: "neutral",
      description: `RSI (${indicators.rsi14.toFixed(1)}) in neutral zone`,
      weight: WEIGHTS.RSI_NEUTRAL,
    });
  }
  
  if (indicators.macdHistogram > 0 && indicators.macdLine > 0) {
    reasons.push({
      indicator: "MACD",
      signal: "bullish",
      description: `MACD histogram positive (${indicators.macdHistogram.toFixed(3)}), bullish momentum`,
      weight: WEIGHTS.MACD_STRONG,
    });
    bullishScore += WEIGHTS.MACD_STRONG;
  } else if (indicators.macdHistogram < 0 && indicators.macdLine < 0) {
    reasons.push({
      indicator: "MACD",
      signal: "bearish",
      description: `MACD histogram negative (${indicators.macdHistogram.toFixed(3)}), bearish momentum`,
      weight: WEIGHTS.MACD_STRONG,
    });
    bearishScore += WEIGHTS.MACD_STRONG;
  } else if (indicators.macdHistogram > 0) {
    reasons.push({
      indicator: "MACD",
      signal: "bullish",
      description: `MACD histogram turning positive`,
      weight: WEIGHTS.MACD_WEAK,
    });
    bullishScore += WEIGHTS.MACD_WEAK;
  } else {
    reasons.push({
      indicator: "MACD",
      signal: "bearish",
      description: `MACD histogram negative (${indicators.macdHistogram.toFixed(3)}), bearish momentum`,
      weight: WEIGHTS.MACD_WEAK,
    });
    bearishScore += WEIGHTS.MACD_WEAK;
  }
  
  if (indicators.stochK < THRESHOLDS.STOCH_OVERSOLD) {
    reasons.push({
      indicator: "Stochastic",
      signal: "bullish",
      description: `Stochastic %K (${indicators.stochK.toFixed(1)}) in oversold territory`,
      weight: WEIGHTS.STOCHASTIC_EXTREME,
    });
    bullishScore += WEIGHTS.STOCHASTIC_EXTREME;
  } else if (indicators.stochK > THRESHOLDS.STOCH_OVERBOUGHT) {
    reasons.push({
      indicator: "Stochastic",
      signal: "bearish",
      description: `Stochastic %K (${indicators.stochK.toFixed(1)}) in overbought territory`,
      weight: WEIGHTS.STOCHASTIC_EXTREME,
    });
    bearishScore += WEIGHTS.STOCHASTIC_EXTREME;
  } else {
    reasons.push({
      indicator: "Stochastic",
      signal: "neutral",
      description: `Stochastic %K (${indicators.stochK.toFixed(1)}) in neutral range`,
      weight: WEIGHTS.STOCHASTIC_NEUTRAL,
    });
  }
  
  if (indicators.priceChange > THRESHOLDS.PRICE_TREND_THRESHOLD) {
    reasons.push({
      indicator: "Price Trend",
      signal: "bullish",
      description: `Price up ${indicators.priceChange.toFixed(2)}% in recent period`,
      weight: WEIGHTS.PRICE_TREND,
    });
    bullishScore += WEIGHTS.PRICE_TREND;
  } else if (indicators.priceChange < -THRESHOLDS.PRICE_TREND_THRESHOLD) {
    reasons.push({
      indicator: "Price Trend",
      signal: "bearish",
      description: `Price down ${Math.abs(indicators.priceChange).toFixed(2)}% in recent period`,
      weight: WEIGHTS.PRICE_TREND,
    });
    bearishScore += WEIGHTS.PRICE_TREND;
  } else {
    reasons.push({
      indicator: "Price Trend",
      signal: "neutral",
      description: `Price relatively stable (${indicators.priceChange.toFixed(2)}%)`,
      weight: WEIGHTS.PRICE_TREND_NEUTRAL,
    });
  }
  
  const patterns = indicators.candlestickPatterns;
  if (patterns.length > 0) {
    // Calculate scores from ALL patterns for signal accuracy
    let totalPatternWeight = 0;
    let dominantType: "bullish" | "bearish" | "neutral" = "neutral";
    let bullishPatternWeight = 0;
    let bearishPatternWeight = 0;
    
    for (const pattern of patterns) {
      const patternWeight = pattern.strength * WEIGHTS.CANDLESTICK_BASE;
      totalPatternWeight += patternWeight;
      
      if (pattern.type === "bullish") {
        bullishScore += patternWeight;
        bullishPatternWeight += patternWeight;
      } else if (pattern.type === "bearish") {
        bearishScore += patternWeight;
        bearishPatternWeight += patternWeight;
      }
    }
    
    // Determine dominant pattern type
    if (bullishPatternWeight > bearishPatternWeight) {
      dominantType = "bullish";
    } else if (bearishPatternWeight > bullishPatternWeight) {
      dominantType = "bearish";
    }
    
    // Add ONLY ONE candlestick pattern entry (most recent) to reasons for display
    const latestPattern = patterns[patterns.length - 1];
    reasons.push({
      indicator: "Candlestick Patterns",
      signal: latestPattern.type,
      description: `${latestPattern.name}: ${latestPattern.description}`,
      weight: latestPattern.strength * WEIGHTS.CANDLESTICK_BASE,
    });
  } else {
    reasons.push({
      indicator: "Candlestick Patterns",
      signal: "neutral",
      description: "No significant candlestick patterns detected",
      weight: 0,
    });
  }
  
  const totalScore = bullishScore + bearishScore;
  const netScore = bullishScore - bearishScore;
  const confidence = totalScore > 0 ? Math.min(Math.abs(netScore) / totalScore * 100, 95) : 0;
  
  let decision: "BUY" | "SELL" | "HOLD";
  if (netScore > THRESHOLDS.BUY_THRESHOLD) {
    decision = "BUY";
  } else if (netScore < THRESHOLDS.SELL_THRESHOLD) {
    decision = "SELL";
  } else {
    decision = "HOLD";
  }
  
  // Detect support and resistance levels
  const supportResistance = detectSupportResistance(candles);
  
  // Calculate precision trade plan with specific entry/SL/TP
  const tradePlan = calculatePrecisionTradePlan(
    decision,
    indicators.currentPrice,
    indicators.atr,
    supportResistance,
    confidence,
    reasons
  );
  
  const atrMultiplier = 1.5;
  let buyTarget: number | null = null;
  let sellTarget: number | null = null;
  
  // Use trade plan values if available, otherwise calculate generic targets
  if (tradePlan) {
    if (decision === "BUY") {
      buyTarget = tradePlan.entryPrice;
      sellTarget = tradePlan.takeProfit2;
    } else if (decision === "SELL") {
      sellTarget = tradePlan.entryPrice;
      buyTarget = tradePlan.takeProfit2;
    }
  } else {
    if (decision === "BUY") {
      buyTarget = indicators.currentPrice;
      sellTarget = indicators.currentPrice + (indicators.atr * atrMultiplier * 2);
    } else if (decision === "SELL") {
      sellTarget = indicators.currentPrice;
      buyTarget = indicators.currentPrice - (indicators.atr * atrMultiplier * 2);
    } else {
      buyTarget = supportResistance.support;
      sellTarget = supportResistance.resistance;
    }
  }
  
  return {
    decision,
    confidence: Math.round(confidence * 10) / 10,
    bullishScore,
    bearishScore,
    netScore,
    reasons,
    indicators,
    targets: {
      buyTarget: buyTarget ? Math.round(buyTarget * 100) / 100 : null,
      sellTarget: sellTarget ? Math.round(sellTarget * 100) / 100 : null,
    },
    tradePlan,
  };
}

export function convertToLegacyIndicatorSignal(result: UnifiedSignalResult): {
  signal: "BUY" | "SELL" | "HOLD";
  strength: number;
  reasons: string[];
} {
  return {
    signal: result.decision,
    strength: result.confidence,
    reasons: result.reasons.map(r => r.description),
  };
}

export function convertToMultiFactorAnalysis(result: UnifiedSignalResult): {
  factors: Array<{
    name: string;
    signal: "BULLISH" | "BEARISH" | "NEUTRAL";
    weight: number;
    description: string;
  }>;
  overallSignal: "BUY" | "SELL" | "HOLD";
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  signalStrength: number;
} {
  const factors = result.reasons.map(r => ({
    name: r.indicator,
    signal: r.signal.toUpperCase() as "BULLISH" | "BEARISH" | "NEUTRAL",
    weight: r.weight,
    description: r.description,
  }));
  
  const bullishCount = result.reasons.filter(r => r.signal === "bullish").length;
  const bearishCount = result.reasons.filter(r => r.signal === "bearish").length;
  const neutralCount = result.reasons.filter(r => r.signal === "neutral").length;
  
  return {
    factors,
    overallSignal: result.decision,
    bullishCount,
    bearishCount,
    neutralCount,
    signalStrength: result.confidence,
  };
}
