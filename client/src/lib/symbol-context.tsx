import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const SUPPORTED_SYMBOLS = [
  { symbol: "XAUUSD", name: "Gold Spot", category: "commodities", currency: "USD" },
  { symbol: "XAGUSD", name: "Silver Spot", category: "commodities", currency: "USD" },
  { symbol: "US10Y", name: "Treasury Yield 10Y", category: "bonds", currency: "USD" },
  { symbol: "GDX", name: "Gold Miners ETF", category: "etf", currency: "USD" },
  { symbol: "DATA", name: "PT Remala Abadi", category: "stocks", currency: "IDR" },
  { symbol: "WIFI", name: "PT Solusi Sinergi Digital", category: "stocks", currency: "IDR" },
  { symbol: "INET", name: "PT Sinergi Inti Andalan Prima", category: "stocks", currency: "IDR" },
  { symbol: "SPX", name: "S&P 500 Index", category: "indices", currency: "USD" },
  { symbol: "BTCUSD", name: "Bitcoin", category: "crypto", currency: "USD" },
  { symbol: "USOIL", name: "Crude Oil WTI", category: "commodities", currency: "USD" },
];

export type SymbolInfo = {
  symbol: string;
  name: string;
  category?: string;
  currency?: string;
};

export function getCurrencySymbol(symbol: string): string {
  const indonesianStocks = ["DATA", "WIFI", "INET"];
  return indonesianStocks.includes(symbol) ? "Rp" : "$";
}

export function formatPrice(price: number, symbol: string): string {
  const currencySymbol = getCurrencySymbol(symbol);
  const indonesianStocks = ["DATA", "WIFI", "INET"];
  const isIDR = indonesianStocks.includes(symbol);
  
  if (isIDR) {
    return `${currencySymbol}${price.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${currencySymbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type SymbolContextType = {
  currentSymbol: SymbolInfo;
  setCurrentSymbol: (symbol: SymbolInfo) => void;
  supportedSymbols: SymbolInfo[];
};

const SymbolContext = createContext<SymbolContextType | null>(null);

const STORAGE_KEY = "tradeviewmon-symbol";

export function SymbolProvider({ children }: { children: ReactNode }) {
  const [currentSymbol, setCurrentSymbolState] = useState<SymbolInfo>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
        }
      }
    }
    return SUPPORTED_SYMBOLS[0];
  });

  const setCurrentSymbol = useCallback((symbol: SymbolInfo) => {
    setCurrentSymbolState(symbol);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbol));
  }, []);

  return (
    <SymbolContext.Provider
      value={{
        currentSymbol,
        setCurrentSymbol,
        supportedSymbols: SUPPORTED_SYMBOLS,
      }}
    >
      {children}
    </SymbolContext.Provider>
  );
}

export function useSymbol() {
  const context = useContext(SymbolContext);
  if (!context) {
    throw new Error("useSymbol must be used within a SymbolProvider");
  }
  return context;
}
