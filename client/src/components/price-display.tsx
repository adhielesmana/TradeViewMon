import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface PriceDisplayProps {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  symbol?: string;
  size?: "sm" | "md" | "lg";
  showSymbol?: boolean;
}

export function PriceDisplay({
  price,
  change,
  changePercent,
  symbol = "AAPL",
  size = "lg",
  showSymbol = true,
}: PriceDisplayProps) {
  const safePrice = price ?? 0;
  const safeChange = change ?? 0;
  const safeChangePercent = changePercent ?? 0;
  
  const isPositive = safeChange > 0;
  const isNegative = safeChange < 0;
  const isNeutral = safeChange === 0;

  const sizeClasses = {
    sm: {
      price: "text-xl font-bold",
      change: "text-sm",
      symbol: "text-sm",
    },
    md: {
      price: "text-2xl font-bold",
      change: "text-base",
      symbol: "text-base",
    },
    lg: {
      price: "text-4xl font-bold",
      change: "text-lg",
      symbol: "text-lg",
    },
  };

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  return (
    <div className="flex flex-col gap-1">
      {showSymbol && (
        <span className={cn("font-medium text-muted-foreground", sizeClasses[size].symbol)}>
          {symbol}
        </span>
      )}
      <span 
        className={cn("font-mono tracking-tight", sizeClasses[size].price)}
        data-testid="text-current-price"
      >
        ${safePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <div 
        className={cn(
          "flex items-center gap-1.5 font-mono",
          sizeClasses[size].change,
          isPositive && "text-profit",
          isNegative && "text-loss",
          isNeutral && "text-neutral"
        )}
        data-testid="text-price-change"
      >
        <TrendIcon className="h-4 w-4" />
        <span>
          {isPositive ? "+" : ""}{safeChange.toFixed(2)}
        </span>
        <span className="text-muted-foreground">
          ({isPositive ? "+" : ""}{safeChangePercent.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}
