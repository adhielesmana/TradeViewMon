import { linearRegression, linearRegressionLine } from "simple-statistics";
import type { MarketData } from "@shared/schema";

export interface PredictionResult {
  predictedPrice: number;
  predictedDirection: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  modelType: string;
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

    const avgPredictedPrice = (movingAvgResult.predictedPrice + regressionResult.predictedPrice) / 2;
    const lastPrice = historicalData[historicalData.length - 1].close;
    const priceChange = avgPredictedPrice - lastPrice;

    let direction: "UP" | "DOWN" | "NEUTRAL";
    const threshold = lastPrice * 0.001 * stepsAhead;
    if (priceChange > threshold) {
      direction = "UP";
    } else if (priceChange < -threshold) {
      direction = "DOWN";
    } else {
      direction = "NEUTRAL";
    }

    const baseConfidence = (movingAvgResult.confidence + regressionResult.confidence) / 2;
    const decayFactor = 1 - (stepsAhead - 1) * 0.05;
    const confidence = Math.min(baseConfidence * decayFactor, 95);

    return {
      predictedPrice: Math.round(avgPredictedPrice * 100) / 100,
      predictedDirection: direction,
      confidence: Math.round(confidence * 100) / 100,
      modelType: "ensemble_ma_lr",
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
