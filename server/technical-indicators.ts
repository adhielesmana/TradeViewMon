import type { MarketData } from "@shared/schema";

export interface IndicatorResult {
  timestamp: Date;
  ema12?: number;
  ema26?: number;
  rsi14?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
}

export interface IndicatorConfig {
  emaPeriods: number[];
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
}

const defaultConfig: IndicatorConfig = {
  emaPeriods: [12, 26],
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
};

export class TechnicalIndicators {
  private config: IndicatorConfig;

  constructor(config: Partial<IndicatorConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period) {
      return new Array(prices.length).fill(null);
    }

    const ema: number[] = [];
    const multiplier = 2 / (period + 1);

    let sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = 0; i < period - 1; i++) {
      ema.push(NaN);
    }
    ema.push(sma);

    for (let i = period; i < prices.length; i++) {
      const currentEma = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
      ema.push(Math.round(currentEma * 100) / 100);
    }

    return ema;
  }

  calculateRSI(prices: number[], period: number = 14): number[] {
    if (prices.length < period + 1) {
      return new Array(prices.length).fill(null);
    }

    const rsi: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    for (let i = 0; i < period; i++) {
      rsi.push(NaN);
    }

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
    }

    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
      }
    }

    return rsi;
  }

  calculateMACD(prices: number[]): {
    macdLine: number[];
    signalLine: number[];
    histogram: number[];
  } {
    const emaFast = this.calculateEMA(prices, this.config.macdFast);
    const emaSlow = this.calculateEMA(prices, this.config.macdSlow);

    const macdLine: number[] = [];
    for (let i = 0; i < prices.length; i++) {
      if (isNaN(emaFast[i]) || isNaN(emaSlow[i])) {
        macdLine.push(NaN);
      } else {
        macdLine.push(Math.round((emaFast[i] - emaSlow[i]) * 100) / 100);
      }
    }

    const validMacd = macdLine.filter(v => !isNaN(v));
    const signalEma = this.calculateEMA(validMacd, this.config.macdSignal);

    const signalLine: number[] = [];
    let signalIndex = 0;
    for (let i = 0; i < macdLine.length; i++) {
      if (isNaN(macdLine[i])) {
        signalLine.push(NaN);
      } else {
        signalLine.push(signalEma[signalIndex] ?? NaN);
        signalIndex++;
      }
    }

    const histogram: number[] = [];
    for (let i = 0; i < macdLine.length; i++) {
      if (isNaN(macdLine[i]) || isNaN(signalLine[i])) {
        histogram.push(NaN);
      } else {
        histogram.push(Math.round((macdLine[i] - signalLine[i]) * 100) / 100);
      }
    }

    return { macdLine, signalLine, histogram };
  }

  calculateAll(data: MarketData[]): IndicatorResult[] {
    const prices = data.map(d => d.close);
    
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const rsi14 = this.calculateRSI(prices, 14);
    const { macdLine, signalLine, histogram } = this.calculateMACD(prices);

    return data.map((d, i) => ({
      timestamp: d.timestamp,
      ema12: isNaN(ema12[i]) ? undefined : ema12[i],
      ema26: isNaN(ema26[i]) ? undefined : ema26[i],
      rsi14: isNaN(rsi14[i]) ? undefined : rsi14[i],
      macdLine: isNaN(macdLine[i]) ? undefined : macdLine[i],
      macdSignal: isNaN(signalLine[i]) ? undefined : signalLine[i],
      macdHistogram: isNaN(histogram[i]) ? undefined : histogram[i],
    }));
  }

  getLatestIndicators(data: MarketData[]): IndicatorResult | null {
    if (data.length === 0) return null;
    const all = this.calculateAll(data);
    return all[all.length - 1];
  }

  generateSignal(indicators: IndicatorResult): {
    signal: "BUY" | "SELL" | "HOLD";
    strength: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let bullishScore = 0;
    let bearishScore = 0;

    if (indicators.rsi14 !== undefined) {
      if (indicators.rsi14 < 30) {
        bullishScore += 2;
        reasons.push("RSI oversold (<30)");
      } else if (indicators.rsi14 > 70) {
        bearishScore += 2;
        reasons.push("RSI overbought (>70)");
      } else if (indicators.rsi14 < 40) {
        bullishScore += 1;
        reasons.push("RSI approaching oversold");
      } else if (indicators.rsi14 > 60) {
        bearishScore += 1;
        reasons.push("RSI approaching overbought");
      }
    }

    if (indicators.macdHistogram !== undefined) {
      if (indicators.macdHistogram > 0) {
        bullishScore += 1;
        reasons.push("MACD histogram positive");
      } else if (indicators.macdHistogram < 0) {
        bearishScore += 1;
        reasons.push("MACD histogram negative");
      }
    }

    if (indicators.ema12 !== undefined && indicators.ema26 !== undefined) {
      if (indicators.ema12 > indicators.ema26) {
        bullishScore += 1;
        reasons.push("EMA12 above EMA26 (bullish trend)");
      } else {
        bearishScore += 1;
        reasons.push("EMA12 below EMA26 (bearish trend)");
      }
    }

    const totalScore = bullishScore + bearishScore;
    let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
    let strength = 0;

    if (bullishScore > bearishScore + 1) {
      signal = "BUY";
      strength = Math.min((bullishScore / totalScore) * 100, 100);
    } else if (bearishScore > bullishScore + 1) {
      signal = "SELL";
      strength = Math.min((bearishScore / totalScore) * 100, 100);
    } else {
      strength = 50;
    }

    return {
      signal,
      strength: Math.round(strength),
      reasons,
    };
  }
}

export const technicalIndicators = new TechnicalIndicators();
