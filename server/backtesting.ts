import { storage } from "./storage";
import { PredictionEngine } from "./prediction-engine";
import type { MarketData } from "@shared/schema";

export interface BacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  timeframe: "1min" | "5min" | "15min";
  lookbackPeriod?: number;
}

export interface BacktestTrade {
  timestamp: Date;
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

export interface BacktestMetrics {
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

export interface BacktestResult {
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { timestamp: Date; equity: number }[];
  runTime: number;
}

export class BacktestingEngine {
  private predictionEngine: PredictionEngine;
  private priceMatchThreshold: number;

  constructor(priceMatchThreshold: number = 0.5) {
    this.predictionEngine = new PredictionEngine(priceMatchThreshold);
    this.priceMatchThreshold = priceMatchThreshold;
  }

  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    const startTime = Date.now();
    
    const marketData = await storage.getMarketDataByTimeRange(
      config.symbol,
      config.startDate,
      config.endDate
    );

    if (marketData.length < 30) {
      throw new Error("Insufficient data for backtesting. Need at least 30 data points.");
    }

    const stepsAhead = this.getStepsAhead(config.timeframe);
    const lookbackPeriod = config.lookbackPeriod || 20;
    const trades: BacktestTrade[] = [];
    const startingEquity = 10000;
    let equity = startingEquity;
    
    const firstTimestamp = marketData[lookbackPeriod]?.timestamp || config.startDate;
    const equityCurve: { timestamp: Date; equity: number }[] = [
      { timestamp: new Date(firstTimestamp), equity: startingEquity }
    ];

    for (let i = lookbackPeriod; i < marketData.length - stepsAhead; i++) {
      const historicalWindow = marketData.slice(i - lookbackPeriod, i + 1);
      const targetIndex = i + stepsAhead;
      
      if (targetIndex >= marketData.length) break;

      const prediction = this.predictionEngine.predict(historicalWindow, stepsAhead);
      const actualCandle = marketData[targetIndex];
      const currentPrice = historicalWindow[historicalWindow.length - 1].close;
      const actualPrice = actualCandle.close;

      const actualDirection = this.getDirection(currentPrice, actualPrice, stepsAhead);
      const priceDifference = actualPrice - prediction.predictedPrice;
      const percentageDifference = (priceDifference / prediction.predictedPrice) * 100;
      const isDirectionMatch = prediction.predictedDirection === actualDirection;
      const isPriceMatch = Math.abs(percentageDifference) <= this.priceMatchThreshold;

      const trade: BacktestTrade = {
        timestamp: new Date(actualCandle.timestamp),
        predictedPrice: prediction.predictedPrice,
        actualPrice,
        predictedDirection: prediction.predictedDirection,
        actualDirection,
        confidence: prediction.confidence,
        priceDifference: Math.round(priceDifference * 100) / 100,
        percentageDifference: Math.round(percentageDifference * 100) / 100,
        isDirectionMatch,
        isPriceMatch,
      };

      trades.push(trade);

      const pnl = this.calculatePnL(prediction.predictedDirection, currentPrice, actualPrice, equity * 0.1);
      equity += pnl;
      equityCurve.push({ timestamp: trade.timestamp, equity: Math.round(equity * 100) / 100 });
    }

    const metrics = this.calculateMetrics(trades, equityCurve, config.timeframe, startingEquity);
    const runTime = Date.now() - startTime;

    return {
      config,
      metrics,
      trades,
      equityCurve,
      runTime,
    };
  }

  private getStepsAhead(timeframe: string): number {
    switch (timeframe) {
      case "1min": return 1;
      case "5min": return 5;
      case "15min": return 15;
      default: return 1;
    }
  }

  private getDirection(currentPrice: number, targetPrice: number, stepsAhead: number): "UP" | "DOWN" | "NEUTRAL" {
    const priceChange = targetPrice - currentPrice;
    const threshold = currentPrice * 0.001 * stepsAhead;
    
    if (priceChange > threshold) return "UP";
    if (priceChange < -threshold) return "DOWN";
    return "NEUTRAL";
  }

  private calculatePnL(
    predictedDirection: "UP" | "DOWN" | "NEUTRAL",
    entryPrice: number,
    exitPrice: number,
    positionSize: number
  ): number {
    if (predictedDirection === "NEUTRAL") return 0;

    const priceChange = exitPrice - entryPrice;
    const percentChange = priceChange / entryPrice;

    if (predictedDirection === "UP") {
      return positionSize * percentChange;
    } else {
      return positionSize * -percentChange;
    }
  }

  private calculateMetrics(
    trades: BacktestTrade[], 
    equityCurve: { timestamp: Date; equity: number }[],
    timeframe: string = "1min",
    startingEquity: number = 10000
  ): BacktestMetrics {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        directionAccuracy: 0,
        priceAccuracy: 0,
        averageError: 0,
        maxError: 0,
        minError: 0,
        profitableTrades: 0,
        lossTrades: 0,
        neutralTrades: 0,
        avgConfidence: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winStreak: 0,
        lossStreak: 0,
        currentStreak: { type: "win", count: 0 },
      };
    }

    const directionMatches = trades.filter(t => t.isDirectionMatch).length;
    const priceMatches = trades.filter(t => t.isPriceMatch).length;
    const errors = trades.map(t => Math.abs(t.percentageDifference));
    
    const profitableTrades = trades.filter(t => 
      (t.predictedDirection === "UP" && t.actualPrice > t.predictedPrice) ||
      (t.predictedDirection === "DOWN" && t.actualPrice < t.predictedPrice)
    ).length;
    
    const lossTrades = trades.filter(t => 
      (t.predictedDirection === "UP" && t.actualPrice < t.predictedPrice) ||
      (t.predictedDirection === "DOWN" && t.actualPrice > t.predictedPrice)
    ).length;
    
    const neutralTrades = trades.filter(t => t.predictedDirection === "NEUTRAL").length;

    let maxStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const trade of trades) {
      if (trade.isDirectionMatch) {
        currentWinStreak++;
        currentLossStreak = 0;
        maxStreak = Math.max(maxStreak, currentWinStreak);
      } else {
        currentLossStreak++;
        currentWinStreak = 0;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      }
    }

    const lastTrade = trades[trades.length - 1];
    const currentStreak = lastTrade.isDirectionMatch 
      ? { type: "win" as const, count: currentWinStreak }
      : { type: "loss" as const, count: currentLossStreak };

    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const ret = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
      returns.push(ret);
    }

    const periodsPerDay = this.getPeriodsPerDay(timeframe);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1 
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const annualizationFactor = Math.sqrt(periodsPerDay * 252);
    const sharpeRatio = stdDev > 0 ? (avgReturn * annualizationFactor) / stdDev : 0;

    let maxDrawdown = 0;
    let peak = startingEquity;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = (peak - point.equity) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return {
      totalTrades: trades.length,
      directionAccuracy: Math.round((directionMatches / trades.length) * 10000) / 100,
      priceAccuracy: Math.round((priceMatches / trades.length) * 10000) / 100,
      averageError: Math.round((errors.reduce((a, b) => a + b, 0) / errors.length) * 100) / 100,
      maxError: Math.round(Math.max(...errors) * 100) / 100,
      minError: Math.round(Math.min(...errors) * 100) / 100,
      profitableTrades,
      lossTrades,
      neutralTrades,
      avgConfidence: Math.round((trades.reduce((sum, t) => sum + t.confidence, 0) / trades.length) * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
      winStreak: maxStreak,
      lossStreak: maxLossStreak,
      currentStreak,
    };
  }

  private getPeriodsPerDay(timeframe: string): number {
    switch (timeframe) {
      case "1min": return 390;
      case "5min": return 78;
      case "15min": return 26;
      default: return 390;
    }
  }
}

export const backtestingEngine = new BacktestingEngine(0.5);
