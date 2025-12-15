import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const SUPPORTED_SYMBOLS = [
  { symbol: "XAUUSD", name: "Gold Spot", category: "commodities" },
  { symbol: "XAGUSD", name: "Silver Spot", category: "commodities" },
  { symbol: "US10Y", name: "Treasury Yield 10Y", category: "bonds" },
  { symbol: "GDX", name: "Gold Miners ETF", category: "etf" },
  { symbol: "DATA", name: "Dropbox Inc", category: "stocks" },
  { symbol: "WIFI", name: "Boingo Wireless", category: "stocks" },
  { symbol: "INET", name: "Internet Initiative Japan", category: "stocks" },
  { symbol: "SPX", name: "S&P 500 Index", category: "indices" },
  { symbol: "BTCUSD", name: "Bitcoin", category: "crypto" },
  { symbol: "USOIL", name: "Crude Oil WTI", category: "commodities" },
];

export type SymbolInfo = {
  symbol: string;
  name: string;
  category?: string;
};

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
