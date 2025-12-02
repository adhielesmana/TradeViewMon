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

  async fetchLatestCandle(symbol?: string): Promise<InsertMarketData> {
    const targetSymbol = symbol || this.currentSymbol;
    const config = this.getConfig(targetSymbol);
    const prices = this.getSymbolPrice(targetSymbol);
    const now = new Date();
    now.setSeconds(0, 0);

    const priceChange = (Math.random() - 0.5) * 2 * config.volatility;
    prices.last += priceChange;
    prices.last = Math.max(prices.last, prices.base * 0.9);
    prices.last = Math.min(prices.last, prices.base * 1.1);

    const priceScale = prices.base > 1000 ? 0.01 : prices.base > 100 ? 0.1 : 0.001;
    const open = prices.last + (Math.random() - 0.5) * priceScale * prices.base;
    const close = prices.last;
    const high = Math.max(open, close) + Math.random() * priceScale * prices.base * 0.5;
    const low = Math.min(open, close) - Math.random() * priceScale * prices.base * 0.5;
    const volume = Math.floor(100000 + Math.random() * 500000);

    const decimals = prices.base > 100 ? 2 : prices.base > 10 ? 3 : 4;
    const factor = Math.pow(10, decimals);

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

  async generateHistoricalData(days: number = 30, symbol?: string): Promise<InsertMarketData[]> {
    const targetSymbol = symbol || this.currentSymbol;
    const config = this.getConfig(targetSymbol);
    const prices = this.getSymbolPrice(targetSymbol);
    const data: InsertMarketData[] = [];
    const now = new Date();
    let currentPrice = prices.base * (0.95 + Math.random() * 0.1);

    const minutesPerDay = config.is24h ? 1440 : 390;
    const totalMinutes = days * minutesPerDay;

    const decimals = prices.base > 100 ? 2 : prices.base > 10 ? 3 : 4;
    const factor = Math.pow(10, decimals);
    const priceScale = prices.base > 1000 ? 0.005 : prices.base > 100 ? 0.01 : 0.002;

    for (let i = totalMinutes; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 60 * 1000);
      
      if (!config.is24h) {
        const hour = timestamp.getHours();
        if (hour < 9 || hour >= 16) continue;
        if (hour === 9 && timestamp.getMinutes() < 30) continue;
        const dayOfWeek = timestamp.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      }

      const trend = Math.sin(i / 1000) * config.volatility;
      const noise = (Math.random() - 0.5) * config.volatility;
      currentPrice += (trend * 0.01 + noise * 0.1) * priceScale * prices.base;

      currentPrice = Math.max(currentPrice, prices.base * 0.85);
      currentPrice = Math.min(currentPrice, prices.base * 1.15);

      const open = currentPrice + (Math.random() - 0.5) * priceScale * prices.base;
      const close = currentPrice;
      const high = Math.max(open, close) + Math.random() * priceScale * prices.base * 0.5;
      const low = Math.min(open, close) - Math.random() * priceScale * prices.base * 0.5;
      const volume = Math.floor(50000 + Math.random() * 300000);

      data.push({
        symbol: targetSymbol,
        timestamp,
        open: Math.round(open * factor) / factor,
        high: Math.round(high * factor) / factor,
        low: Math.round(low * factor) / factor,
        close: Math.round(close * factor) / factor,
        volume,
        interval: "1min",
      });
    }

    prices.last = currentPrice;
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
