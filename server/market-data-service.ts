import type { InsertMarketData } from "@shared/schema";

// API provider types
type ApiProvider = "gold-api" | "finnhub" | "yahoo" | "simulated";

interface SymbolConfig {
  basePrice: number;
  volatility: number;
  is24h: boolean;
  provider: ApiProvider;
  apiSymbol?: string;  // Gold-API symbol (XAU, XAG, BTC)
  finnhubSymbol?: string;  // Finnhub stock/ETF symbol
  yahooSymbol?: string;  // Yahoo Finance symbol (e.g., DATA.JK for IDX stocks)
  priceMultiplier?: number;  // For ETF proxies that need price adjustment
}

const SYMBOL_CONFIGS: Record<string, SymbolConfig> = {
  // Precious Metals - Gold-API primary (accurate ~$4,600 price), Yahoo Finance futures as fallback
  // Note: Finnhub OANDA symbols require paid subscription, so we use Gold-API + Yahoo
  XAUUSD: { basePrice: 4600.00, volatility: 0.3, is24h: true, provider: "gold-api", apiSymbol: "XAU", yahooSymbol: "GC=F" },
  XAGUSD: { basePrice: 84.00, volatility: 0.5, is24h: true, provider: "gold-api", apiSymbol: "XAG", yahooSymbol: "SI=F" },
  // Crypto - Finnhub primary (BINANCE real-time), Gold-API as fallback
  BTCUSD: { basePrice: 91000.00, volatility: 1.5, is24h: true, provider: "finnhub", apiSymbol: "BTC", finnhubSymbol: "BINANCE:BTCUSDT" },
  
  // Mining Stocks - Finnhub (direct symbols)
  GDX: { basePrice: 35.50, volatility: 0.4, is24h: false, provider: "finnhub", finnhubSymbol: "GDX" },
  
  // Indonesian Stocks - Yahoo Finance (IDX stocks use .JK suffix)
  DATA: { basePrice: 4060.00, volatility: 0.5, is24h: false, provider: "yahoo", yahooSymbol: "DATA.JK" },
  WIFI: { basePrice: 3600.00, volatility: 0.4, is24h: false, provider: "yahoo", yahooSymbol: "WIFI.JK" },
  INET: { basePrice: 795.00, volatility: 0.4, is24h: false, provider: "yahoo", yahooSymbol: "INET.JK" },
  BBCA: { basePrice: 9500.00, volatility: 0.3, is24h: false, provider: "yahoo", yahooSymbol: "BBCA.JK" },
  
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

  // Fetch company info from Yahoo Finance for auto-detection of stock descriptions
  // Returns company name and currency for the given symbol
  async fetchCompanyInfo(symbol: string, isIndonesian: boolean = false): Promise<{ name: string; currency: string; exchange: string } | null> {
    try {
      const yahooSymbol = isIndonesian ? `${symbol}.JK` : symbol;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        console.log(`[MarketData] Yahoo Finance info fetch failed for ${yahooSymbol}: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      const meta = data?.chart?.result?.[0]?.meta;
      
      if (!meta) {
        console.log(`[MarketData] No meta data from Yahoo for ${yahooSymbol}`);
        return null;
      }
      
      // Yahoo returns short name and long name
      let companyName = meta.longName || meta.shortName || symbol;
      const currency = meta.currency || (isIndonesian ? "IDR" : "USD");
      const exchange = meta.exchangeName || meta.exchange || (isIndonesian ? "IDX" : "");
      
      // Clean up common suffixes for Indonesian stocks
      if (isIndonesian && companyName) {
        // Add (IDX) suffix if not already present
        if (!companyName.includes("(IDX)") && !companyName.includes("IDX")) {
          companyName = `${companyName} (IDX)`;
        }
      }
      
      console.log(`[MarketData] ✓ Fetched company info for ${symbol}: "${companyName}" (${currency}, ${exchange})`);
      
      return { name: companyName, currency, exchange };
    } catch (error) {
      console.error(`[MarketData] Error fetching company info for ${symbol}:`, error);
      return null;
    }
  }

  // Dynamically register an Indonesian stock for Yahoo Finance fetching
  // Called when symbols with (IDX) in displayName are created/updated
  registerIndonesianStock(symbol: string): boolean {
    const normalizedSymbol = symbol.trim().toUpperCase();
    
    // Skip if already registered (idempotent)
    if (SYMBOL_CONFIGS[normalizedSymbol]) {
      console.log(`[MarketData] Indonesian stock ${normalizedSymbol} already registered`);
      return false;
    }
    
    // Create config for Yahoo Finance with .JK suffix
    const yahooSymbol = `${normalizedSymbol}.JK`;
    const config: SymbolConfig = {
      basePrice: 5000, // Default base price for IDR stocks
      volatility: 0.3,
      is24h: false,
      provider: "yahoo",
      yahooSymbol: yahooSymbol,
    };
    
    // Add to SYMBOL_CONFIGS dynamically
    SYMBOL_CONFIGS[normalizedSymbol] = config;
    
    // Initialize in symbolPrices map
    this.symbolPrices.set(normalizedSymbol, { base: config.basePrice, last: config.basePrice });
    
    console.log(`[MarketData] ✓ Registered Indonesian stock: ${normalizedSymbol} → Yahoo:${yahooSymbol}`);
    return true;
  }

  // Load Indonesian stocks from database on startup
  async loadIndonesianStocksFromDatabase(getMonitoredSymbols: () => Promise<Array<{ symbol: string; displayName: string; currency: string; isActive: boolean }>>): Promise<void> {
    try {
      const symbols = await getMonitoredSymbols();
      let registered = 0;
      
      for (const sym of symbols) {
        // Detect Indonesian stocks by (IDX) in displayName OR currency = IDR
        const isIndonesianStock = sym.displayName.includes("(IDX)") || sym.currency === "IDR";
        
        if (isIndonesianStock && sym.isActive) {
          if (this.registerIndonesianStock(sym.symbol)) {
            registered++;
          }
        }
      }
      
      if (registered > 0) {
        console.log(`[MarketData] Loaded ${registered} Indonesian stocks from database`);
      }
    } catch (error) {
      console.error("[MarketData] Failed to load Indonesian stocks from database:", error);
    }
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

  // Fetch from Yahoo Finance (free, no key required) - for Indonesian stocks
  private async fetchYahooPrice(symbol: string, config: SymbolConfig): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    if (!config.yahooSymbol) {
      return null;
    }

    try {
      // Yahoo Finance v8 API endpoint
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${config.yahooSymbol}?interval=1m&range=1d`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        console.error(`[MarketData] Yahoo Finance API error: ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      
      if (!result || !result.meta?.regularMarketPrice) {
        console.error(`[MarketData] Yahoo Finance returned no data for ${config.yahooSymbol}`);
        return null;
      }
      
      const price = result.meta.regularMarketPrice;
      const previousClose = result.meta.previousClose || price;
      const changePercent = ((price - previousClose) / previousClose * 100).toFixed(2);
      
      console.log(`[MarketData] ✓ Yahoo Finance Response for ${symbol} (via ${config.yahooSymbol}):`);
      console.log(`  - Price: ${price} IDR`);
      console.log(`  - Previous Close: ${previousClose} IDR`);
      console.log(`  - Change: ${Number(changePercent) >= 0 ? '+' : ''}${changePercent}%`);
      
      return { 
        price, 
        updatedAt: new Date().toISOString(), 
        provider: `Yahoo (${config.yahooSymbol})` 
      };
    } catch (error) {
      console.error(`[MarketData] Failed to fetch Yahoo Finance price:`, error);
      return null;
    }
  }

  // Fetch from TradingView (unofficial API as fallback)
  private async fetchTradingViewPrice(symbol: string, config: SymbolConfig): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    // Map our symbols to TradingView symbols
    const tvSymbolMap: Record<string, string> = {
      "XAUUSD": "OANDA:XAUUSD",
      "XAGUSD": "OANDA:XAGUSD",
      "BTCUSD": "BITSTAMP:BTCUSD",
      "GDX": "AMEX:GDX",
      "SPX": "SP:SPX",
      "USOIL": "TVC:USOIL",
    };

    const tvSymbol = tvSymbolMap[symbol];
    if (!tvSymbol) {
      return null;
    }

    try {
      // TradingView's symbol info endpoint (publicly accessible)
      const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(tvSymbol)}&type=stock,futures,forex,crypto&hl=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        console.error(`[MarketData] TradingView search error: ${response.status}`);
        return null;
      }
      
      // TradingView search doesn't return live prices, so we'll use their quotes endpoint
      // This is a basic fallback - returns search results only
      console.log(`[MarketData] TradingView: Symbol ${tvSymbol} search successful (price requires different endpoint)`);
      return null; // TradingView requires websocket for live data
    } catch (error) {
      console.error(`[MarketData] Failed to fetch TradingView data:`, error);
      return null;
    }
  }

  // Compare prices from multiple sources and choose the most reliable one
  // For crypto: Finnhub (BINANCE) primary, Gold-API fallback
  // For metals: Gold-API primary, Yahoo Finance futures fallback
  private async fetchMultiSourcePrice(symbol: string): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    const config = this.getConfig(symbol);
    const results: Array<{ price: number; updatedAt: string; provider: string; priority: number }> = [];

    // Fetch from all available sources in parallel
    const fetchPromises: Promise<void>[] = [];

    // For symbols with Finnhub (crypto): Finnhub is primary
    if (config.finnhubSymbol && this.finnhubApiKey) {
      fetchPromises.push(
        this.fetchFinnhubPrice(symbol, config).then(result => {
          if (result) results.push({ ...result, priority: 1 });
        })
      );
    }

    // Gold-API for metals/crypto (primary for metals, fallback for crypto)
    if (config.apiSymbol) {
      const priority = config.finnhubSymbol ? 2 : 1; // Primary if no Finnhub
      fetchPromises.push(
        this.fetchGoldApiPrice(symbol, config).then(result => {
          if (result) results.push({ ...result, priority });
        })
      );
    }

    // Yahoo Finance for metals futures (secondary verification for XAU/XAG)
    if (config.yahooSymbol && (symbol === "XAUUSD" || symbol === "XAGUSD")) {
      fetchPromises.push(
        this.fetchYahooPrice(symbol, config).then(result => {
          if (result) results.push({ ...result, priority: 2 });
        })
      );
    }

    await Promise.all(fetchPromises);

    if (results.length === 0) {
      console.log(`[MarketData] ${symbol}: No price sources available`);
      return null;
    }

    if (results.length === 1) {
      const best = results[0];
      console.log(`[MarketData] ${symbol}: Single source - ${best.provider} @ $${best.price.toFixed(2)}`);
      return { price: best.price, updatedAt: best.updatedAt, provider: best.provider };
    }

    // Multiple sources - compare and validate
    results.sort((a, b) => a.priority - b.priority);
    const primary = results[0];
    const secondary = results[1];

    const priceDiff = Math.abs(primary.price - secondary.price);
    const priceDiffPercent = (priceDiff / primary.price) * 100;

    console.log(`[MarketData] ${symbol}: Price comparison:`);
    console.log(`  - ${primary.provider}: $${primary.price.toFixed(2)} (PRIMARY)`);
    console.log(`  - ${secondary.provider}: $${secondary.price.toFixed(2)} (verification)`);
    console.log(`  - Difference: $${priceDiff.toFixed(2)} (${priceDiffPercent.toFixed(3)}%)`);

    // If difference is > 2%, log warning
    if (priceDiffPercent > 2) {
      console.warn(`[MarketData] ⚠ ${symbol}: Price discrepancy ${priceDiffPercent.toFixed(2)}% between sources`);
    }

    // Use primary source (verified against secondary)
    return { price: primary.price, updatedAt: primary.updatedAt, provider: `${primary.provider} (verified)` };
  }

  // Main method to fetch real price from appropriate provider
  private async fetchRealPrice(symbol: string): Promise<{ price: number; updatedAt: string; provider: string } | null> {
    const config = this.getConfig(symbol);
    
    // Use multi-source comparison for:
    // 1. Crypto (BTCUSD): Finnhub + Gold-API
    // 2. Metals (XAUUSD, XAGUSD): Gold-API + Yahoo Finance futures
    if (config.finnhubSymbol && config.apiSymbol) {
      // Crypto: Finnhub primary, Gold-API fallback
      return this.fetchMultiSourcePrice(symbol);
    }
    
    if (config.apiSymbol && config.yahooSymbol && (symbol === "XAUUSD" || symbol === "XAGUSD")) {
      // Metals: Gold-API primary, Yahoo futures verification
      return this.fetchMultiSourcePrice(symbol);
    }
    
    switch (config.provider) {
      case "finnhub":
        // Finnhub-only symbols (stocks, ETFs)
        return this.fetchFinnhubPrice(symbol, config);
      case "gold-api":
        // Gold-API only
        return this.fetchGoldApiPrice(symbol, config);
      case "yahoo":
        return this.fetchYahooPrice(symbol, config);
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

  // Get symbol configs for seeding monitored symbols table
  getSymbolConfigs(): Array<{ symbol: string; displayName: string; category: string; currency: string }> {
    const configs: Array<{ symbol: string; displayName: string; category: string; currency: string }> = [];
    
    for (const [symbol, config] of Object.entries(SYMBOL_CONFIGS)) {
      let displayName = symbol;
      let category = "Other";
      let currency = "USD";
      
      // Set display name, category, and currency based on symbol
      if (symbol === "XAUUSD") { displayName = "Gold (XAU/USD)"; category = "Precious Metals"; }
      else if (symbol === "XAGUSD") { displayName = "Silver (XAG/USD)"; category = "Precious Metals"; }
      else if (symbol === "BTCUSD") { displayName = "Bitcoin (BTC/USD)"; category = "Crypto"; }
      else if (symbol === "GDX") { displayName = "Gold Miners ETF"; category = "Mining Stocks"; }
      else if (symbol === "DATA") { displayName = "DATA (IDX)"; category = "Indonesian Stocks"; currency = "IDR"; }
      else if (symbol === "WIFI") { displayName = "WIFI (IDX)"; category = "Indonesian Stocks"; currency = "IDR"; }
      else if (symbol === "INET") { displayName = "INET (IDX)"; category = "Indonesian Stocks"; currency = "IDR"; }
      else if (symbol === "SPX") { displayName = "S&P 500 Index"; category = "Indices"; }
      else if (symbol === "USOIL") { displayName = "Crude Oil (WTI)"; category = "Commodities"; }
      else if (symbol === "US10Y") { displayName = "US 10Y Treasury"; category = "Bonds"; }
      
      configs.push({ symbol, displayName, category, currency });
    }
    
    return configs;
  }

  setCurrentSymbol(symbol: string): void {
    if (SYMBOL_CONFIGS[symbol]) {
      this.currentSymbol = symbol;
    }
  }
}

export const marketDataService = new MarketDataService("XAUUSD");
