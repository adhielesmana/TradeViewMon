import { storage } from "./storage";
import type { CurrencyRateResponse } from "@shared/schema";

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
}

const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
];

const FRANKFURTER_API = "https://api.frankfurter.dev/v1";

class CurrencyService {
  private lastFetchTime: Date | null = null;
  private cachedRates: Map<string, number> = new Map();

  async fetchRatesFromAPI(): Promise<Map<string, number>> {
    try {
      const symbols = SUPPORTED_CURRENCIES
        .filter(c => c.code !== "USD")
        .map(c => c.code)
        .join(",");
      
      const url = `${FRANKFURTER_API}/latest?base=USD&symbols=${symbols}`;
      console.log(`[Currency] Fetching rates from Frankfurter API...`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Frankfurter API error: ${response.status}`);
      }
      
      const data: FrankfurterResponse = await response.json();
      console.log(`[Currency] Received rates for ${Object.keys(data.rates).length} currencies (date: ${data.date})`);
      
      const rates = new Map<string, number>();
      rates.set("USD", 1);
      
      for (const [currency, rate] of Object.entries(data.rates)) {
        rates.set(currency, rate);
      }
      
      this.cachedRates = rates;
      this.lastFetchTime = new Date();
      
      return rates;
    } catch (error) {
      console.error("[Currency] Failed to fetch rates from API:", error);
      throw error;
    }
  }

  async updateRates(): Promise<void> {
    try {
      const rates = await this.fetchRatesFromAPI();
      const now = new Date();
      
      for (const [currency, rate] of rates.entries()) {
        await storage.upsertCurrencyRate({
          baseCurrency: "USD",
          targetCurrency: currency,
          rate,
          source: "frankfurter",
          fetchedAt: now,
          updatedAt: now,
        });
      }
      
      console.log(`[Currency] Updated ${rates.size} currency rates in database`);
    } catch (error) {
      console.error("[Currency] Failed to update rates:", error);
    }
  }

  async getRates(): Promise<CurrencyRateResponse[]> {
    const dbRates = await storage.getAllCurrencyRates();
    
    if (dbRates.length === 0) {
      console.log("[Currency] No rates in database, fetching from API...");
      await this.updateRates();
      return this.getRates();
    }
    
    const lastUpdate = dbRates[0]?.fetchedAt;
    const hoursSinceUpdate = lastUpdate 
      ? (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60)
      : Infinity;
    
    if (hoursSinceUpdate > 12) {
      console.log(`[Currency] Rates are ${hoursSinceUpdate.toFixed(1)} hours old, refreshing...`);
      this.updateRates().catch(console.error);
    }
    
    return SUPPORTED_CURRENCIES.map(currency => {
      const dbRate = dbRates.find(r => r.targetCurrency === currency.code);
      return {
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        rate: dbRate?.rate ?? (currency.code === "USD" ? 1 : 0),
        lastUpdated: dbRate?.fetchedAt?.toISOString() ?? new Date().toISOString(),
      };
    });
  }

  async getRate(targetCurrency: string): Promise<number | null> {
    if (targetCurrency === "USD") return 1;
    
    const dbRate = await storage.getCurrencyRate("USD", targetCurrency);
    if (dbRate) {
      return dbRate.rate;
    }
    
    if (this.cachedRates.has(targetCurrency)) {
      return this.cachedRates.get(targetCurrency) ?? null;
    }
    
    await this.updateRates();
    return this.cachedRates.get(targetCurrency) ?? null;
  }

  shouldUpdate(): boolean {
    if (!this.lastFetchTime) return true;
    const hoursSinceUpdate = (Date.now() - this.lastFetchTime.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate >= 12;
  }
}

export const currencyService = new CurrencyService();
