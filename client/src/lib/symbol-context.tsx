import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type SymbolInfo = {
  symbol: string;
  name: string;
  category?: string;
  currency?: string;
};

// Fallback symbols only used when database is empty or API unavailable
const FALLBACK_SYMBOLS: SymbolInfo[] = [
  { symbol: "XAUUSD", name: "Gold Spot", category: "commodities", currency: "USD" },
  { symbol: "XAGUSD", name: "Silver Spot", category: "commodities", currency: "USD" },
  { symbol: "BTCUSD", name: "Bitcoin", category: "crypto", currency: "USD" },
];

// Get currency symbol - driven exclusively from SymbolInfo.currency from database
export function getCurrencySymbol(symbolInfo?: SymbolInfo | null): string {
  if (symbolInfo?.currency === "IDR") {
    return "Rp";
  }
  // Default to USD for all other currencies
  return "$";
}

// Format price based on currency from SymbolInfo
export function formatPrice(price: number, symbolInfo?: SymbolInfo | null): string {
  const currencySymbol = getCurrencySymbol(symbolInfo);
  const isIDR = symbolInfo?.currency === "IDR";
  
  if (isIDR) {
    return `${currencySymbol}${price.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${currencySymbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type SymbolContextType = {
  currentSymbol: SymbolInfo;
  setCurrentSymbol: (symbol: SymbolInfo) => void;
  supportedSymbols: SymbolInfo[];
  isLoading: boolean;
};

const SymbolContext = createContext<SymbolContextType | null>(null);

const STORAGE_KEY = "trady-symbol";

export function SymbolProvider({ children }: { children: ReactNode }) {
  // Fetch symbols from database via API
  const { data: apiSymbols, isLoading } = useQuery<SymbolInfo[]>({
    queryKey: ["/api/market/symbols"],
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });

  // Use API symbols if available, otherwise fallback
  const supportedSymbols = useMemo(() => {
    return apiSymbols && apiSymbols.length > 0 ? apiSymbols : FALLBACK_SYMBOLS;
  }, [apiSymbols]);

  // Load stored symbol from localStorage (full SymbolInfo to preserve currency)
  const [storedSymbol, setStoredSymbol] = useState<SymbolInfo | null>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          return JSON.parse(stored) as SymbolInfo;
        } catch {
          // Ignore parse errors
        }
      }
    }
    return null;
  });

  // Track selected symbol code
  const selectedSymbolCode = storedSymbol?.symbol || FALLBACK_SYMBOLS[0].symbol;

  // Track whether we've received real API data (not just fallback)
  const hasApiData = apiSymbols && apiSymbols.length > 0;

  // Derive currentSymbol from supportedSymbols using the selected code
  // This ensures we always use the latest SymbolInfo with fresh currency data
  const currentSymbol = useMemo(() => {
    const found = supportedSymbols.find(s => s.symbol === selectedSymbolCode);
    if (found) return found;
    // Selected symbol not found - only fall back if we have real API data
    if (hasApiData) {
      return supportedSymbols[0];
    }
    // During initial load, use stored SymbolInfo to preserve currency
    if (storedSymbol) {
      return storedSymbol;
    }
    // Ultimate fallback
    return FALLBACK_SYMBOLS[0];
  }, [supportedSymbols, selectedSymbolCode, hasApiData, storedSymbol]);

  // Update localStorage and state when we have confirmed data from API
  useEffect(() => {
    if (hasApiData) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSymbol));
      // Sync storedSymbol state to keep it in sync with currentSymbol
      if (storedSymbol?.symbol !== currentSymbol.symbol ||
          storedSymbol?.currency !== currentSymbol.currency) {
        setStoredSymbol(currentSymbol);
      }
    }
  }, [currentSymbol, hasApiData, storedSymbol]);

  // Handle symbol deletion - only run when we have real API data
  useEffect(() => {
    if (!hasApiData) return; // Don't reset during initial load with fallback
    const stillExists = supportedSymbols.some(s => s.symbol === selectedSymbolCode);
    if (!stillExists && supportedSymbols.length > 0) {
      const newSymbol = supportedSymbols[0];
      setStoredSymbol(newSymbol);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSymbol));
    }
  }, [supportedSymbols, selectedSymbolCode, hasApiData]);

  const setCurrentSymbol = useCallback((symbol: SymbolInfo) => {
    setStoredSymbol(symbol);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbol));
  }, []);

  return (
    <SymbolContext.Provider
      value={{
        currentSymbol,
        setCurrentSymbol,
        supportedSymbols,
        isLoading,
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
