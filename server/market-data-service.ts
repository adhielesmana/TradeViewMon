import type { InsertMarketData } from "@shared/schema";

export class MarketDataService {
  private readonly symbol: string;
  private basePrice: number;
  private lastPrice: number;
  private apiKey: string | null;

  constructor(symbol: string = "AAPL") {
    this.symbol = symbol;
    this.basePrice = 185.50;
    this.lastPrice = this.basePrice;
    this.apiKey = process.env.ALPHA_VANTAGE_API_KEY || null;
  }

  async fetchLatestCandle(): Promise<InsertMarketData> {
    const now = new Date();
    now.setSeconds(0, 0);

    const priceChange = (Math.random() - 0.5) * 2;
    const volatility = 0.5 + Math.random() * 0.5;
    
    this.lastPrice += priceChange * volatility;
    this.lastPrice = Math.max(this.lastPrice, this.basePrice * 0.9);
    this.lastPrice = Math.min(this.lastPrice, this.basePrice * 1.1);

    const open = this.lastPrice + (Math.random() - 0.5) * 0.5;
    const close = this.lastPrice;
    const high = Math.max(open, close) + Math.random() * 0.3;
    const low = Math.min(open, close) - Math.random() * 0.3;
    const volume = Math.floor(100000 + Math.random() * 500000);

    return {
      symbol: this.symbol,
      timestamp: now,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
      interval: "1min",
    };
  }

  async generateHistoricalData(days: number = 30): Promise<InsertMarketData[]> {
    const data: InsertMarketData[] = [];
    const now = new Date();
    let currentPrice = this.basePrice - 10 + Math.random() * 20;

    const minutesPerDay = 390;
    const totalMinutes = days * minutesPerDay;

    for (let i = totalMinutes; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 60 * 1000);
      
      const hour = timestamp.getHours();
      if (hour < 9 || hour >= 16) continue;
      if (hour === 9 && timestamp.getMinutes() < 30) continue;

      const dayOfWeek = timestamp.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const trend = Math.sin(i / 1000) * 2;
      const noise = (Math.random() - 0.5) * 1.5;
      currentPrice += trend * 0.01 + noise * 0.1;

      currentPrice = Math.max(currentPrice, this.basePrice * 0.85);
      currentPrice = Math.min(currentPrice, this.basePrice * 1.15);

      const open = currentPrice + (Math.random() - 0.5) * 0.3;
      const close = currentPrice;
      const high = Math.max(open, close) + Math.random() * 0.2;
      const low = Math.min(open, close) - Math.random() * 0.2;
      const volume = Math.floor(50000 + Math.random() * 300000);

      data.push({
        symbol: this.symbol,
        timestamp,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume,
        interval: "1min",
      });
    }

    this.lastPrice = currentPrice;
    return data;
  }

  getSymbol(): string {
    return this.symbol;
  }
}

export const marketDataService = new MarketDataService("AAPL");
