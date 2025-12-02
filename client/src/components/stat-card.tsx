import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: LucideIcon;
  className?: string;
  valueClassName?: string;
  testId?: string;
}

export function StatCard({
  label,
  value,
  subValue,
  trend,
  trendValue,
  icon: Icon,
  className,
  valueClassName,
  testId,
}: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
            <span 
              className={cn(
                "text-2xl font-bold font-mono tracking-tight",
                valueClassName
              )}
              data-testid={testId || `text-stat-${label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {typeof value === "number" 
                ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : value
              }
            </span>
            {subValue && (
              <span className="text-xs text-muted-foreground font-mono">
                {subValue}
              </span>
            )}
            {trend && trendValue && (
              <div className={cn(
                "flex items-center gap-1 text-sm font-medium",
                trend === "up" && "text-profit",
                trend === "down" && "text-loss",
                trend === "neutral" && "text-muted-foreground"
              )}>
                {trend === "up" && <TrendingUp className="h-3 w-3" />}
                {trend === "down" && <TrendingDown className="h-3 w-3" />}
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className="rounded-md bg-muted p-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
