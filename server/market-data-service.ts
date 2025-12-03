import type { InsertMarketData } from "@shared/schema";

const SYMBOL_CONFIGS: Record<string, { basePrice: number; volatility: number; is24h: boolean }> = {
  XAUUSD: { basePrice: 2650.00, volatility: 0.3, is24h: true },
  DXY: { basePrice: 106.50, volatility: 0.1, is24h: true },
  XAGUSD: { basePrice: 31.50, volatility: 0.5, is24h: true },
  US10Y: { basePrice: 4.35, volatility: 0.05, is24h: false },
  GDX: { basePrice: 35.50, volatility: 0.4, is24h: false },
  GDXJ: { basePrice: 42.00, volatility: 0.5, is24h: false },
  NEM: { basePrice: 48.50, volatility: 0.4, is24h: false },
  SPX: { basePrice: 6050.00, volatility: 0.2, is24h: false },
  BTCUSD: { basePrice: 97500.00, volatility: 1.5, is24h: true },
  USOIL: { basePrice: 71.50, volatility: 0.6, is24h: true },
};

export class MarketDataService {
  private currentSymbol: string;
  private symbolPrices: Map<string, { base: number; last: number }>;
  private apiKey: string | null;

  constructor(defaultSymbol: string = "XAUUSD") {
    this.currentSymbol = defaultSymbol;
    this.symbolPrices = new Map();
    
    for (const [symbol, config] of Object.entries(SYMBOL_CONFIGS)) {
      this.symbolPrices.set(symbol, { base: config.basePrice, last: config.basePrice });
    }
    
    this.apiKey = process.env.ALPHA_VANTAGE_API_KEY || null;
  }

  private getConfig(symbol: string) {
    return SYMBOL_CONFIGS[symbol] || SYMBOL_CONFIGS.XAUUSD;
  }

  private getSymbolPrice(symbol: string) {
    if (!this.symbolPrices.has(symbol)) {
      const config = this.getConfig(symbol);
      this.symbolPrices.set(symbol, { base: config.basePrice, last: config.basePrice });
    }
    return this.symbolPrices.get(symbol)!;
  }

  async fetchLatestCandle(symbol?: string, lastClosePrice?: number): Promise<InsertMarketData> {
    const targetSymbol = symbol || this.currentSymbol;
    const config = this.getConfig(targetSymbol);
    const prices = this.getSymbolPrice(targetSymbol);
    const now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);

    const decimals = prices.base > 100 ? 2 : prices.base > 10 ? 3 : 4;
    const factor = Math.pow(10, decimals);
    
    const open = lastClosePrice !== undefined ? lastClosePrice : prices.last;
    
    const priceChange = (Math.random() - 0.5) * 2 * config.volatility * 0.15 * prices.base * 0.001;
    let close = open + priceChange;
    
    close = Math.max(close, prices.base * 0.9);
    close = Math.min(close, prices.base * 1.1);
    
    const bodyTop = Math.max(open, close);
    const bodyBottom = Math.min(open, close);
    const wickSize = prices.base * 0.001 * Math.random();
    
    const high = bodyTop + wickSize;
    const low = bodyBottom - wickSize;
    
    const volume = Math.floor(10000 + Math.random() * 100000);
    
    prices.last = close;

    return {
      symbol: targetSymbol,
      timestamp: now,
      open: Math.round(open * factor) / factor,
      high: Math.round(high * factor) / factor,
      low: Math.round(low * factor) / factor,
      close: Math.round(close * factor) / factor,
      volume,
      interval: "1min",
    };
  }

  async generateHistoricalData(hours: number = 1, symbol?: string): Promise<InsertMarketData[]> {
    const targetSymbol = symbol || this.currentSymbol;
    const config = this.getConfig(targetSymbol);
    const prices = this.getSymbolPrice(targetSymbol);
    const data: InsertMarketData[] = [];
    const now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);
    
    let lastClose = prices.base * (0.98 + Math.random() * 0.04);
    const totalIntervals = hours * 60;

    const decimals = prices.base > 100 ? 2 : prices.base > 10 ? 3 : 4;
    const factor = Math.pow(10, decimals);

    for (let i = totalIntervals; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 60 * 1000);

      const trend = Math.sin(i / 30) * config.volatility * 0.3;
      const noise = (Math.random() - 0.5) * config.volatility * 0.15;
      const priceChange = (trend + noise * 0.3) * prices.base * 0.001;
      
      const open = lastClose;
      const close = open + priceChange;
      
      const bodyTop = Math.max(open, close);
      const bodyBottom = Math.min(open, close);
      const wickSize = prices.base * 0.001 * Math.random();
      
      const high = bodyTop + wickSize;
      const low = bodyBottom - wickSize;
      
      const volume = Math.floor(10000 + Math.random() * 100000);

      const clampedClose = Math.max(Math.min(close, prices.base * 1.05), prices.base * 0.95);

      data.push({
        symbol: targetSymbol,
        timestamp,
        open: Math.round(open * factor) / factor,
        high: Math.round(high * factor) / factor,
        low: Math.round(low * factor) / factor,
        close: Math.round(clampedClose * factor) / factor,
        volume,
        interval: "1min",
      });
      
      lastClose = clampedClose;
    }

    prices.last = lastClose;
    return data;
  }

  getSymbol(): string {
    return this.currentSymbol;
  }

  getSupportedSymbols(): string[] {
    return Object.keys(SYMBOL_CONFIGS);
  }

  setCurrentSymbol(symbol: string): void {
    if (SYMBOL_CONFIGS[symbol]) {
      this.currentSymbol = symbol;
    }
  }
}

export const marketDataService = new MarketDataService("XAUUSD");
