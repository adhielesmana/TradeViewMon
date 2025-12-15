import type { InsertMarketData } from "@shared/schema";

// API provider types
type ApiProvider = "gold-api" | "finnhub" | "simulated";

interface SymbolConfig {
  basePrice: number;
  volatility: number;
  is24h: boolean;
  provider: ApiProvider;
  apiSymbol?: string;  // Gold-API symbol (XAU, XAG, BTC)
  finnhubSymbol?: string;  // Finnhub stock/ETF symbol
  priceMultiplier?: number;  // For ETF proxies that need price adjustment
}

const SYMBOL_CONFIGS: Record<string, SymbolConfig> = {
  // Precious Metals & Crypto - Gold-API (free, no key required)
  XAUUSD: { basePrice: 2650.00, volatility: 0.3, is24h: true, provider: "gold-api", apiSymbol: "XAU" },
  XAGUSD: { basePrice: 31.50, volatility: 0.5, is24h: true, provider: "gold-api", apiSymbol: "XAG" },
  BTCUSD: { basePrice: 97500.00, volatility: 1.5, is24h: true, provider: "gold-api", apiSymbol: "BTC" },
  
  // Mining Stocks - Finnhub (direct symbols)
  GDX: { basePrice: 35.50, volatility: 0.4, is24h: false, provider: "finnhub", finnhubSymbol: "GDX" },
  
  // Indonesian Stocks - Simulated (Finnhub doesn't support IDX)
  DATA: { basePrice: 4060.00, volatility: 0.5, is24h: false, provider: "simulated" },
  WIFI: { basePrice: 3600.00, volatility: 0.4, is24h: false, provider: "simulated" },
  INET: { basePrice: 795.00, volatility: 0.4, is24h: false, provider: "simulated" },
  
  // Indices & Commodities - Finnhub (via ETF proxies)
  SPX: { basePrice: 6050.00, volatility: 0.2, is24h: false, provider: "finnhub", finnhubSymbol: "SPY", priceMultiplier: 10 },
  USOIL: { basePrice: 71.50, volatility: 0.6, is24h: true, provider: "finnhub", finnhubSymbol: "USO", priceMultiplier: 1 },
  
  // Treasury Yield - Simulated (no good free API)
  US10Y: { basePrice: 4.35, volatility: 0.05, is24h: false, provider: "simulated" },
};

interface GoldApiResponse {
  name: string;
  price: number;
  symbol: string;
  updatedAt: string;
  updatedAtReadable: string;
}

interface FinnhubQuoteResponse {
  c: number;   // Current price
  d: number;   // Change
  dp: number;  // Percent change
  h: number;   // High of day
  l: number;   // Low of day
  o: number;   // Open price
  pc: number;  // Previous close
  t: number;   // Timestamp
}

export class MarketDataService {
  private currentSymbol: string;
  private symbolPrices: Map<string, { base: number; last: number }>;
  private useRealApi: boolean;
  private finnhubApiKey: string | null;
  private keySource: "none" | "environment" | "database" = "none";

  constructor(defaultSymbol: string = "XAUUSD") {
    this.currentSymbol = defaultSymbol;
    this.symbolPrices = new Map();
    this.useRealApi = true;
    this.finnhubApiKey = process.env.FINNHUB_API_KEY || null;
    
    if (this.finnhubApiKey) {
      this.keySource = "environment";
      console.log("[MarketData] Finnhub API key configured from environment - real-time stock data enabled");
    } else {
      console.log("[MarketData] No Finnhub API key in environment - will check database on init");
    }
    
    for (const [symbol, config] of Object.entries(SYMBOL_CONFIGS)) {
      this.symbolPrices.set(symbol, { base: config.basePrice, last: config.basePrice });
    }
  }

  // Initialize with database key (called on server startup)
  async initializeFromDatabase(getDbKey: () => Promise<string | null>): Promise<void> {
    // Only load from database if env var is not set
    if (!process.env.FINNHUB_API_KEY) {
      const dbKey = await getDbKey();
      if (dbKey) {
        this.finnhubApiKey = dbKey;
        this.keySource = "database";
        console.log("[MarketData] Finnhub API key loaded from database - real-time stock data enabled");
      } else {
        console.log("[MarketData] No Finnhub API key in database - stocks will use simulated data");
      }
    }
  }

  // Update Finnhub API key (called when user saves from settings)
  updateFinnhubApiKey(key: string | undefined): void {
    if (key) {
      this.finnhubApiKey = key;
      this.keySource = "database";
      console.log("[MarketData] Finnhub API key updated - real-time stock data enabled");
    } else {
      this.finnhubApiKey = process.env.FINNHUB_API_KEY || null;
      this.keySource = this.finnhubApiKey ? "environment" : "none";
      console.log("[MarketData] Finnhub API key cleared - reverting to env var or simulated data");
    }
  }

  // Get current Finnhub API key status (for settings page)
  getFinnhubKeyStatus(): { isConfigured: boolean; source: string; maskedValue: string | null } {
    const key = this.finnhubApiKey;
    const isConfigured = !!key;
    
    let maskedValue: string | null = null;
    if (key && key.length > 4) {
      maskedValue = `****${key.slice(-4)}`;
    } else if (key) {
      maskedValue = "****";
    }
    
    return { isConfigured, source: this.keySource, maskedValue };
  }

  private getConfig(symbol: string): SymbolConfig {
    return SYMBOL_CONFIGS[symbol] || SYMBOL_CONFIGS.XAUUSD;
  }

  private getSymbolPrice(symbol: string) {
    if (!this.symbolPrices.has(symbol)) {
      const config = this.getConfig(symbol);
      this.symbolPrices.set(symbol, { base: config.basePrice, last: config.basePrice });
    }
    return this.symbolPrices.get(symbol)!;
  }

  // Fetch from Gold-API (free, no key required) - for precious metals & crypto
  private async fetchGoldApiPrice(symbol: string, config: SymbolConfig): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    if (!config.apiSymbol) {
      return null;
    }

    try {
      const response = await fetch(`https://api.gold-api.com/price/${config.apiSymbol}`);
      if (!response.ok) {
        console.error(`[MarketData] Gold-API error: ${response.status}`);
        return null;
      }
      
      const data: GoldApiResponse = await response.json();
      console.log(`[MarketData] ✓ Gold-API Response for ${symbol}:`);
      console.log(`  - Name: ${data.name}`);
      console.log(`  - Price: $${data.price}`);
      console.log(`  - Symbol: ${data.symbol}`);
      console.log(`  - Updated: ${data.updatedAt}`);
      return { price: data.price, updatedAt: data.updatedAt, provider: "Gold-API" };
    } catch (error) {
      console.error(`[MarketData] Failed to fetch Gold-API price:`, error);
      return null;
    }
  }

  // Fetch from Finnhub (free with API key) - for stocks & ETFs
  private async fetchFinnhubPrice(symbol: string, config: SymbolConfig): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    if (!this.finnhubApiKey || !config.finnhubSymbol) {
      return null;
    }

    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${config.finnhubSymbol}&token=${this.finnhubApiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`[MarketData] Finnhub API error: ${response.status}`);
        return null;
      }
      
      const data: FinnhubQuoteResponse = await response.json();
      
      // Check if we got valid data (Finnhub returns 0 for invalid symbols)
      if (data.c === 0 && data.h === 0 && data.l === 0) {
        console.error(`[MarketData] Finnhub returned no data for ${config.finnhubSymbol}`);
        return null;
      }
      
      // Apply price multiplier for ETF proxies (e.g., SPY → SPX)
      const multiplier = config.priceMultiplier || 1;
      const adjustedPrice = data.c * multiplier;
      
      console.log(`[MarketData] ✓ Finnhub Response for ${symbol} (via ${config.finnhubSymbol}):`);
      console.log(`  - Raw Price: $${data.c}`);
      if (multiplier !== 1) {
        console.log(`  - Multiplier: ${multiplier}x → $${adjustedPrice.toFixed(2)}`);
      }
      console.log(`  - Change: ${data.dp >= 0 ? '+' : ''}${data.dp.toFixed(2)}%`);
      
      return { 
        price: adjustedPrice, 
        updatedAt: new Date().toISOString(), 
        provider: `Finnhub (${config.finnhubSymbol})` 
      };
    } catch (error) {
      console.error(`[MarketData] Failed to fetch Finnhub price:`, error);
      return null;
    }
  }

  // Main method to fetch real price from appropriate provider
  private async fetchRealPrice(symbol: string): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    const config = this.getConfig(symbol);
    
    switch (config.provider) {
      case "gold-api":
        return this.fetchGoldApiPrice(symbol, config);
      case "finnhub":
        return this.fetchFinnhubPrice(symbol, config);
      case "simulated":
      default:
        return null;
    }
  }

  async fetchLatestCandle(symbol?: string, lastClosePrice?: number): Promise<InsertMarketData> {
    const targetSymbol = symbol || this.currentSymbol;
    const config = this.getConfig(targetSymbol);
    const prices = this.getSymbolPrice(targetSymbol);
    const now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);

    let close: number;
    let dataSource = "simulated";
    
    if (this.useRealApi) {
      const apiResult = await this.fetchRealPrice(targetSymbol);
      if (apiResult !== null) {
        close = apiResult.price;
        prices.base = apiResult.price;
        dataSource = apiResult.provider;
      } else {
        const priceChange = (Math.random() - 0.5) * 2 * config.volatility * 0.15 * prices.base * 0.001;
        close = (lastClosePrice || prices.last) + priceChange;
      }
    } else {
      const priceChange = (Math.random() - 0.5) * 2 * config.volatility * 0.15 * prices.base * 0.001;
      close = (lastClosePrice || prices.last) + priceChange;
    }

    const decimals = prices.base > 100 ? 2 : prices.base > 10 ? 3 : 4;
    const factor = Math.pow(10, decimals);
    
    const open = lastClosePrice !== undefined ? lastClosePrice : close;
    
    const bodyTop = Math.max(open, close);
    const bodyBottom = Math.min(open, close);
    const wickSize = Math.abs(close - open) * 0.1 + prices.base * 0.0002 * Math.random();
    
    const high = bodyTop + wickSize;
    const low = bodyBottom - wickSize;
    
    const volume = Math.floor(10000 + Math.random() * 100000);
    
    prices.last = close;

    const candle = {
      symbol: targetSymbol,
      timestamp: now,
      open: Math.round(open * factor) / factor,
      high: Math.round(high * factor) / factor,
      low: Math.round(low * factor) / factor,
      close: Math.round(close * factor) / factor,
      volume,
      interval: "1min",
    };

    console.log(`[MarketData] Storing candle (${dataSource}):`);
    console.log(`  - Symbol: ${candle.symbol}`);
    console.log(`  - Time: ${candle.timestamp.toISOString()}`);
    console.log(`  - O: $${candle.open} | H: $${candle.high} | L: $${candle.low} | C: $${candle.close}`);

    return candle;
  }

  async generateHistoricalData(hours: number = 1, symbol?: string): Promise<InsertMarketData[]> {
    const targetSymbol = symbol || this.currentSymbol;
    const config = this.getConfig(targetSymbol);
    const prices = this.getSymbolPrice(targetSymbol);
    const data: InsertMarketData[] = [];
    const now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);
    
    let currentPrice = prices.base;
    let dataSource = "simulated";
    
    if (this.useRealApi) {
      const apiResult = await this.fetchRealPrice(targetSymbol);
      if (apiResult !== null) {
        currentPrice = apiResult.price;
        prices.base = apiResult.price;
        dataSource = apiResult.provider;
      }
    }
    
    console.log(`[MarketData] Generating ${hours}h historical data for ${targetSymbol} (base: $${currentPrice}, source: ${dataSource})`);
    
    let lastClose = currentPrice * (0.999 + Math.random() * 0.002);
    const totalIntervals = hours * 60;

    const decimals = currentPrice > 100 ? 2 : currentPrice > 10 ? 3 : 4;
    const factor = Math.pow(10, decimals);

    for (let i = totalIntervals; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 60 * 1000);

      const trend = Math.sin(i / 30) * config.volatility * 0.05;
      const noise = (Math.random() - 0.5) * config.volatility * 0.02;
      const priceChange = (trend + noise * 0.3) * currentPrice * 0.0002;
      
      const open = lastClose;
      let close = open + priceChange;
      
      const progress = (totalIntervals - i) / totalIntervals;
      close = open + (currentPrice - open) * progress * 0.02 + priceChange;
      close = Math.max(Math.min(close, currentPrice * 1.005), currentPrice * 0.995);
      
      const bodyTop = Math.max(open, close);
      const bodyBottom = Math.min(open, close);
      const wickSize = Math.abs(close - open) * 0.15 + currentPrice * 0.0001 * Math.random();
      
      const high = bodyTop + wickSize;
      const low = bodyBottom - wickSize;
      
      const volume = Math.floor(10000 + Math.random() * 100000);

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
      
      lastClose = close;
    }

    prices.last = lastClose;
    console.log(`[MarketData] Generated ${data.length} candles, last close: $${lastClose.toFixed(2)}`);
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
