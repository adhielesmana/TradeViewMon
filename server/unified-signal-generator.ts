import type { MarketData } from "@shared/schema";

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
  // Raised from ±20 to ±40 to require multi-factor agreement for stronger signals
  BUY_THRESHOLD: 40,
  SELL_THRESHOLD: -40,
};

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

function detectCandlestickPatterns(candles: MarketData[]): CandlestickPattern[] {
  if (candles.length < 3) return [];
  
  const patterns: CandlestickPattern[] = [];
  const trend = detectTrend(candles, 10);
  const currentCandle = candles[candles.length - 1];
  const { body, totalRange, upperWick, lowerWick } = getCandleMetrics(currentCandle);
  
  if (totalRange === 0) return [];
  
  const bodyRatio = body / totalRange;
  const lowerWickRatio = lowerWick / totalRange;
  const upperWickRatio = upperWick / totalRange;
  
  if (bodyRatio < 0.35 && lowerWickRatio > 0.5 && upperWickRatio < 0.15) {
    if (trend === "downtrend" || trend === "sideways") {
      patterns.push({
        name: "Hammer",
        type: "bullish",
        strength: trend === "downtrend" ? 3 : 2,
        description: "Hammer pattern - potential bullish reversal"
      });
    } else if (trend === "uptrend") {
      patterns.push({
        name: "Hanging Man",
        type: "bearish",
        strength: 2,
        description: "Hanging Man pattern - momentum may be weakening"
      });
    }
  }
  
  if (bodyRatio < 0.35 && upperWickRatio > 0.5 && lowerWickRatio < 0.15) {
    if (trend === "uptrend" || trend === "sideways") {
      patterns.push({
        name: "Shooting Star",
        type: "bearish",
        strength: trend === "uptrend" ? 3 : 2,
        description: "Shooting Star pattern - potential bearish reversal"
      });
    }
  }
  
  if (bodyRatio < 0.1) {
    patterns.push({
      name: "Doji",
      type: "neutral",
      strength: 2,
      description: "Doji - market indecision, potential trend change"
    });
  }
  
  if (candles.length >= 2) {
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    const prevMetrics = getCandleMetrics(prev);
    const currMetrics = getCandleMetrics(curr);
    
    if (prevMetrics.isBearish && currMetrics.isBullish) {
      if (curr.open < prev.close && curr.close > prev.open && currMetrics.body > prevMetrics.body * 1.2) {
        if (trend === "downtrend" || trend === "sideways") {
          patterns.push({
            name: "Bullish Engulfing",
            type: "bullish",
            strength: 3,
            description: "Bullish Engulfing - strong potential upward reversal"
          });
        }
      }
    }
    
    if (prevMetrics.isBullish && currMetrics.isBearish) {
      if (curr.open > prev.close && curr.close < prev.open && currMetrics.body > prevMetrics.body * 1.2) {
        if (trend === "uptrend" || trend === "sideways") {
          patterns.push({
            name: "Bearish Engulfing",
            type: "bearish",
            strength: 3,
            description: "Bearish Engulfing - strong potential downward reversal"
          });
        }
      }
    }
  }
  
  return patterns;
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
    for (const pattern of patterns) {
      const patternWeight = pattern.strength * WEIGHTS.CANDLESTICK_BASE;
      
      reasons.push({
        indicator: `Candlestick Patterns`,
        signal: pattern.type,
        description: pattern.description,
        weight: patternWeight,
      });
      
      if (pattern.type === "bullish") {
        bullishScore += patternWeight;
      } else if (pattern.type === "bearish") {
        bearishScore += patternWeight;
      }
    }
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
  
  const atrMultiplier = 1.5;
  let buyTarget: number | null = null;
  let sellTarget: number | null = null;
  
  if (decision === "BUY") {
    buyTarget = indicators.currentPrice;
    sellTarget = indicators.currentPrice + (indicators.atr * atrMultiplier * 2);
  } else if (decision === "SELL") {
    sellTarget = indicators.currentPrice;
    buyTarget = indicators.currentPrice - (indicators.atr * atrMultiplier * 2);
  } else {
    buyTarget = indicators.currentPrice - (indicators.atr * atrMultiplier);
    sellTarget = indicators.currentPrice + (indicators.atr * atrMultiplier);
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
