import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const SUPPORTED_SYMBOLS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "META", name: "Meta Platforms Inc." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "JNJ", name: "Johnson & Johnson" },
];

export type SymbolInfo = {
  symbol: string;
  name: string;
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
