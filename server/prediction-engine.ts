import { linearRegression, linearRegressionLine } from "simple-statistics";
import type { MarketData } from "@shared/schema";

export interface FactorSignal {
  name: string;
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  weight: number;
  value?: number;
  description: string;
}

export interface MultiFactorAnalysis {
  factors: FactorSignal[];
  overallSignal: "BUY" | "SELL" | "HOLD";
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  signalStrength: number;
}

export interface PredictionResult {
  predictedPrice: number;
  predictedDirection: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  modelType: string;
  multiFactorAnalysis?: MultiFactorAnalysis;
}

export class PredictionEngine {
  private readonly matchThreshold: number;

  constructor(matchThreshold: number = 0.5) {
    this.matchThreshold = matchThreshold;
  }

  predict(historicalData: MarketData[], stepsAhead: number = 1): PredictionResult {
    if (historicalData.length < 5) {
      return this.fallbackPrediction(historicalData);
    }

    const movingAvgResult = this.movingAveragePrediction(historicalData, stepsAhead);
    const regressionResult = this.linearRegressionPrediction(historicalData, stepsAhead);
    
    const multiFactorAnalysis = this.performMultiFactorAnalysis(historicalData);
    const hasValidAnalysis = multiFactorAnalysis.factors.length >= 2 && multiFactorAnalysis.signalStrength > 10;

    const avgPredictedPrice = (movingAvgResult.predictedPrice + regressionResult.predictedPrice) / 2;
    const lastPrice = historicalData[historicalData.length - 1].close;
    const priceChange = avgPredictedPrice - lastPrice;

    let direction: "UP" | "DOWN" | "NEUTRAL";
    const threshold = lastPrice * 0.001 * stepsAhead;
    
    if (hasValidAnalysis && multiFactorAnalysis.overallSignal === "BUY" && priceChange > -threshold) {
      direction = "UP";
    } else if (hasValidAnalysis && multiFactorAnalysis.overallSignal === "SELL" && priceChange < threshold) {
      direction = "DOWN";
    } else if (priceChange > threshold) {
      direction = "UP";
    } else if (priceChange < -threshold) {
      direction = "DOWN";
    } else {
      direction = "NEUTRAL";
    }

    const baseConfidence = (movingAvgResult.confidence + regressionResult.confidence) / 2;
    const factorBoost = hasValidAnalysis ? multiFactorAnalysis.signalStrength * 0.1 : 0;
    const decayFactor = 1 - (stepsAhead - 1) * 0.05;
    const confidence = Math.min((baseConfidence + factorBoost) * decayFactor, 95);

    return {
      predictedPrice: Math.round(avgPredictedPrice * 100) / 100,
      predictedDirection: direction,
      confidence: Math.round(confidence * 100) / 100,
      modelType: "ensemble_multifactor",
      multiFactorAnalysis,
    };
  }

  private movingAveragePrediction(data: MarketData[], stepsAhead: number = 1): PredictionResult {
    const shortPeriod = Math.min(5, data.length);
    const longPeriod = Math.min(20, data.length);

    const shortMA = this.calculateMA(data.slice(-shortPeriod));
    const longMA = this.calculateMA(data.slice(-longPeriod));

    const lastPrice = data[data.length - 1].close;
    const trend = shortMA - longMA;
    const predictedPrice = lastPrice + trend * 0.5 * stepsAhead;

    const volatility = this.calculateVolatility(data.slice(-10));
    const confidence = Math.max(20, 80 - volatility * 10);

    let direction: "UP" | "DOWN" | "NEUTRAL";
    if (trend > 0) {
      direction = "UP";
    } else if (trend < 0) {
      direction = "DOWN";
    } else {
      direction = "NEUTRAL";
    }

    return {
      predictedPrice: Math.round(predictedPrice * 100) / 100,
      predictedDirection: direction,
      confidence,
      modelType: "moving_average",
    };
  }

  private linearRegressionPrediction(data: MarketData[], stepsAhead: number = 1): PredictionResult {
    const recentData = data.slice(-20);
    const points: [number, number][] = recentData.map((d, i) => [i, d.close]);

    try {
      const regression = linearRegression(points);
      const predict = linearRegressionLine(regression);
      const predictedPrice = predict(recentData.length + stepsAhead - 1);

      const lastPrice = recentData[recentData.length - 1].close;
      const priceChange = predictedPrice - lastPrice;

      let direction: "UP" | "DOWN" | "NEUTRAL";
      const threshold = lastPrice * 0.001 * stepsAhead;
      if (priceChange > threshold) {
        direction = "UP";
      } else if (priceChange < -threshold) {
        direction = "DOWN";
      } else {
        direction = "NEUTRAL";
      }

      const r2 = this.calculateR2(points, regression);
      const confidence = Math.max(30, Math.min(90, r2 * 100));

      return {
        predictedPrice: Math.round(predictedPrice * 100) / 100,
        predictedDirection: direction,
        confidence,
        modelType: "linear_regression",
      };
    } catch {
      return this.fallbackPrediction(data);
    }
  }

  private fallbackPrediction(data: MarketData[]): PredictionResult {
    if (data.length === 0) {
      return {
        predictedPrice: 0,
        predictedDirection: "NEUTRAL",
        confidence: 0,
        modelType: "fallback",
      };
    }

    const lastPrice = data[data.length - 1].close;
    return {
      predictedPrice: lastPrice,
      predictedDirection: "NEUTRAL",
      confidence: 10,
      modelType: "fallback",
    };
  }

  private calculateMA(data: MarketData[]): number {
    if (data.length === 0) return 0;
    return data.reduce((sum, d) => sum + d.close, 0) / data.length;
  }

  private calculateVolatility(data: MarketData[]): number {
    if (data.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < data.length; i++) {
      returns.push((data[i].close - data[i - 1].close) / data[i - 1].close);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * 100;
  }

  private calculateR2(
    points: [number, number][],
    regression: { m: number; b: number }
  ): number {
    const yMean = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const ssTot = points.reduce((sum, p) => sum + Math.pow(p[1] - yMean, 2), 0);
    const ssRes = points.reduce((sum, p) => {
      const predicted = regression.m * p[0] + regression.b;
      return sum + Math.pow(p[1] - predicted, 2);
    }, 0);

    if (ssTot === 0) return 0;
    return Math.max(0, 1 - ssRes / ssTot);
  }

  calculateSMA(data: MarketData[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    return slice.reduce((sum, d) => sum + d.close, 0) / period;
  }

  calculateEMA(data: MarketData[], period: number): number {
    if (data.length < period) return 0;
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, d) => sum + d.close, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = (data[i].close - ema) * multiplier + ema;
    }
    return ema;
  }

  calculateRSI(data: MarketData[], period: number = 14): number {
    if (data.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = data.length - period; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateMACD(data: MarketData[]): { macdLine: number; signalLine: number; histogram: number } {
    if (data.length < 26) {
      return { macdLine: 0, signalLine: 0, histogram: 0 };
    }
    
    const closes = data.map(d => d.close);
    
    const calculateEMAFromPrices = (prices: number[], period: number): number[] => {
      if (prices.length < period) return [];
      const multiplier = 2 / (period + 1);
      const emaValues: number[] = [];
      let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
      emaValues.push(ema);
      
      for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
        emaValues.push(ema);
      }
      return emaValues;
    };
    
    const ema12Values = calculateEMAFromPrices(closes, 12);
    const ema26Values = calculateEMAFromPrices(closes, 26);
    
    const offset = 26 - 12;
    const macdValues: number[] = [];
    for (let i = 0; i < ema26Values.length; i++) {
      const ema12Index = i + offset;
      if (ema12Index < ema12Values.length) {
        macdValues.push(ema12Values[ema12Index] - ema26Values[i]);
      }
    }
    
    if (macdValues.length === 0) {
      return { macdLine: 0, signalLine: 0, histogram: 0 };
    }
    
    const macdLine = macdValues[macdValues.length - 1];
    
    if (macdValues.length < 9) {
      return { macdLine, signalLine: macdLine, histogram: 0 };
    }
    
    const signalMultiplier = 2 / 10;
    let signalLine = macdValues.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let i = 9; i < macdValues.length; i++) {
      signalLine = (macdValues[i] - signalLine) * signalMultiplier + signalLine;
    }
    
    return {
      macdLine,
      signalLine,
      histogram: macdLine - signalLine,
    };
  }

  calculateStochastic(data: MarketData[], period: number = 14): { k: number; d: number } {
    if (data.length < period) {
      return { k: 50, d: 50 };
    }
    
    const recent = data.slice(-period);
    const currentClose = data[data.length - 1].close;
    const lowestLow = Math.min(...recent.map(d => d.low));
    const highestHigh = Math.max(...recent.map(d => d.high));
    
    if (highestHigh === lowestLow) {
      return { k: 50, d: 50 };
    }
    
    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    
    const kValues: number[] = [];
    for (let i = period; i <= data.length; i++) {
      const slice = data.slice(i - period, i);
      const close = slice[slice.length - 1].close;
      const low = Math.min(...slice.map(d => d.low));
      const high = Math.max(...slice.map(d => d.high));
      if (high !== low) {
        kValues.push(((close - low) / (high - low)) * 100);
      }
    }
    
    const d = kValues.length >= 3 
      ? kValues.slice(-3).reduce((a, b) => a + b, 0) / 3 
      : k;
    
    return { k, d };
  }

  analyzeVolume(data: MarketData[]): { trend: "INCREASING" | "DECREASING" | "STABLE"; ratio: number } {
    if (data.length < 20) {
      return { trend: "STABLE", ratio: 1 };
    }
    
    const recentVol = data.slice(-5).reduce((sum, d) => sum + d.volume, 0) / 5;
    const avgVol = data.slice(-20).reduce((sum, d) => sum + d.volume, 0) / 20;
    
    if (avgVol === 0) {
      return { trend: "STABLE", ratio: 1 };
    }
    
    const ratio = recentVol / avgVol;
    
    if (ratio > 1.5) {
      return { trend: "INCREASING", ratio };
    } else if (ratio < 0.7) {
      return { trend: "DECREASING", ratio };
    }
    return { trend: "STABLE", ratio };
  }

  performMultiFactorAnalysis(data: MarketData[]): MultiFactorAnalysis {
    const factors: FactorSignal[] = [];
    const currentPrice = data.length > 0 ? data[data.length - 1].close : 0;
    
    if (data.length >= 20) {
      const ma7 = this.calculateSMA(data, Math.min(7, data.length));
      const ma20 = this.calculateSMA(data, Math.min(20, data.length));
      
      if (currentPrice > ma7 && ma7 > ma20) {
        factors.push({
          name: "MA Short-Term Trend",
          signal: "BULLISH",
          weight: 15,
          value: ma7,
          description: "Price above MA7 > MA20 (short-term uptrend)",
        });
      } else if (currentPrice < ma7 && ma7 < ma20) {
        factors.push({
          name: "MA Short-Term Trend",
          signal: "BEARISH",
          weight: 15,
          value: ma7,
          description: "Price below MA7 < MA20 (short-term downtrend)",
        });
      } else {
        factors.push({
          name: "MA Short-Term Trend",
          signal: "NEUTRAL",
          weight: 15,
          value: ma7,
          description: "Mixed short-term MA signals",
        });
      }
    }
    
    if (data.length >= 50) {
      const ma50 = this.calculateSMA(data, 50);
      
      if (data.length >= 200) {
        const ma200 = this.calculateSMA(data, 200);
        
        if (ma50 > ma200) {
          factors.push({
            name: "MA Long-Term Trend",
            signal: "BULLISH",
            weight: 20,
            value: ma50,
            description: "MA50 above MA200 (golden cross territory)",
          });
        } else if (ma50 < ma200) {
          factors.push({
            name: "MA Long-Term Trend",
            signal: "BEARISH",
            weight: 20,
            value: ma50,
            description: "MA50 below MA200 (death cross territory)",
          });
        } else {
          factors.push({
            name: "MA Long-Term Trend",
            signal: "NEUTRAL",
            weight: 20,
            value: ma50,
            description: "MA50 and MA200 converging",
          });
        }
      } else {
        const ma20 = this.calculateSMA(data, 20);
        if (currentPrice > ma50 && ma50 > ma20) {
          factors.push({
            name: "MA Mid-Term Trend",
            signal: "BULLISH",
            weight: 15,
            value: ma50,
            description: "Price above MA50 > MA20 (mid-term uptrend)",
          });
        } else if (currentPrice < ma50 && ma50 < ma20) {
          factors.push({
            name: "MA Mid-Term Trend",
            signal: "BEARISH",
            weight: 15,
            value: ma50,
            description: "Price below MA50 < MA20 (mid-term downtrend)",
          });
        } else {
          factors.push({
            name: "MA Mid-Term Trend",
            signal: "NEUTRAL",
            weight: 15,
            value: ma50,
            description: "Mixed mid-term MA signals",
          });
        }
      }
    }
    
    if (data.length >= 15) {
      const rsi = this.calculateRSI(data, 14);
      if (rsi < 30) {
        factors.push({
          name: "RSI (14)",
          signal: "BULLISH",
          weight: 20,
          value: rsi,
          description: `RSI at ${rsi.toFixed(1)} - oversold condition`,
        });
      } else if (rsi > 70) {
        factors.push({
          name: "RSI (14)",
          signal: "BEARISH",
          weight: 20,
          value: rsi,
          description: `RSI at ${rsi.toFixed(1)} - overbought condition`,
        });
      } else {
        factors.push({
          name: "RSI (14)",
          signal: "NEUTRAL",
          weight: 20,
          value: rsi,
          description: `RSI at ${rsi.toFixed(1)} - neutral zone`,
        });
      }
    }
    
    if (data.length >= 35) {
      const macd = this.calculateMACD(data);
      if (macd.histogram > 0 && macd.macdLine > macd.signalLine) {
        factors.push({
          name: "MACD",
          signal: "BULLISH",
          weight: 20,
          value: macd.histogram,
          description: "MACD above signal line with positive histogram",
        });
      } else if (macd.histogram < 0 && macd.macdLine < macd.signalLine) {
        factors.push({
          name: "MACD",
          signal: "BEARISH",
          weight: 20,
          value: macd.histogram,
          description: "MACD below signal line with negative histogram",
        });
      } else {
        factors.push({
          name: "MACD",
          signal: "NEUTRAL",
          weight: 20,
          value: macd.histogram,
          description: "MACD showing mixed signals",
        });
      }
    }
    
    if (data.length >= 14) {
      const stoch = this.calculateStochastic(data, 14);
      if (stoch.k < 20 && stoch.d < 20) {
        factors.push({
          name: "Stochastic (14)",
          signal: "BULLISH",
          weight: 15,
          value: stoch.k,
          description: `Stochastic K=${stoch.k.toFixed(1)} - oversold`,
        });
      } else if (stoch.k > 80 && stoch.d > 80) {
        factors.push({
          name: "Stochastic (14)",
          signal: "BEARISH",
          weight: 15,
          value: stoch.k,
          description: `Stochastic K=${stoch.k.toFixed(1)} - overbought`,
        });
      } else {
        factors.push({
          name: "Stochastic (14)",
          signal: "NEUTRAL",
          weight: 15,
          value: stoch.k,
          description: `Stochastic K=${stoch.k.toFixed(1)} - neutral zone`,
        });
      }
    }
    
    if (data.length >= 20) {
      const volume = this.analyzeVolume(data);
      const lastCandle = data[data.length - 1];
      const priceUp = lastCandle.close > lastCandle.open;
      
      if (volume.trend === "INCREASING" && priceUp) {
        factors.push({
          name: "Volume Analysis",
          signal: "BULLISH",
          weight: 10,
          value: volume.ratio,
          description: `Volume ${(volume.ratio * 100).toFixed(0)}% of avg - confirming upward move`,
        });
      } else if (volume.trend === "INCREASING" && !priceUp) {
        factors.push({
          name: "Volume Analysis",
          signal: "BEARISH",
          weight: 10,
          value: volume.ratio,
          description: `Volume ${(volume.ratio * 100).toFixed(0)}% of avg - confirming downward move`,
        });
      } else {
        factors.push({
          name: "Volume Analysis",
          signal: "NEUTRAL",
          weight: 10,
          value: volume.ratio,
          description: `Volume at ${(volume.ratio * 100).toFixed(0)}% of average`,
        });
      }
    }
    
    let bullishWeight = 0;
    let bearishWeight = 0;
    let neutralWeight = 0;
    let totalWeight = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;
    
    for (const factor of factors) {
      totalWeight += factor.weight;
      if (factor.signal === "BULLISH") {
        bullishWeight += factor.weight;
        bullishCount++;
      } else if (factor.signal === "BEARISH") {
        bearishWeight += factor.weight;
        bearishCount++;
      } else {
        neutralWeight += factor.weight;
        neutralCount++;
      }
    }
    
    if (factors.length === 0 || totalWeight === 0) {
      return {
        factors,
        overallSignal: "HOLD",
        bullishCount: 0,
        bearishCount: 0,
        neutralCount: 0,
        signalStrength: 0,
      };
    }
    
    const bullishRatio = bullishWeight / totalWeight;
    const bearishRatio = bearishWeight / totalWeight;
    const netRatio = bullishRatio - bearishRatio;
    
    const signalStrength = Math.round(Math.abs(netRatio) * 100);
    
    let overallSignal: "BUY" | "SELL" | "HOLD";
    
    if (netRatio > 0.25 && bullishCount >= 2) {
      overallSignal = "BUY";
    } else if (netRatio < -0.25 && bearishCount >= 2) {
      overallSignal = "SELL";
    } else {
      overallSignal = "HOLD";
    }
    
    return {
      factors,
      overallSignal,
      bullishCount,
      bearishCount,
      neutralCount,
      signalStrength,
    };
  }

  compareWithActual(
    predictedPrice: number,
    actualPrice: number
  ): { isMatch: boolean; priceDifference: number; percentageDifference: number } {
    const priceDifference = actualPrice - predictedPrice;
    const percentageDifference = (priceDifference / predictedPrice) * 100;
    const isMatch = Math.abs(percentageDifference) <= this.matchThreshold;

    return {
      isMatch,
      priceDifference: Math.round(priceDifference * 100) / 100,
      percentageDifference: Math.round(percentageDifference * 100) / 100,
    };
  }
}

export const predictionEngine = new PredictionEngine(0.5);
