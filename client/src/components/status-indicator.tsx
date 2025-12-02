import { cn } from "@/lib/utils";

interface StatusIndicatorProps {
  status: "healthy" | "degraded" | "error" | "online" | "offline";
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}

export function StatusIndicator({ 
  status, 
  showLabel = false, 
  size = "md",
  pulse = true 
}: StatusIndicatorProps) {
  const sizeClasses = {
    sm: "h-2 w-2",
    md: "h-2.5 w-2.5",
    lg: "h-3 w-3",
  };

  const statusColors = {
    healthy: "bg-profit",
    online: "bg-profit",
    degraded: "bg-yellow-500",
    error: "bg-loss",
    offline: "bg-neutral",
  };

  const statusLabels = {
    healthy: "Healthy",
    online: "Online",
    degraded: "Degraded",
    error: "Error",
    offline: "Offline",
  };

  return (
    <div className="flex items-center gap-2">
      <span 
        className={cn(
          "rounded-full",
          sizeClasses[size],
          statusColors[status],
          pulse && (status === "healthy" || status === "online") && "animate-pulse-dot"
        )}
        data-testid={`status-indicator-${status}`}
      />
      {showLabel && (
        <span className="text-sm text-muted-foreground">
          {statusLabels[status]}
        </span>
      )}
    </div>
  );
}
