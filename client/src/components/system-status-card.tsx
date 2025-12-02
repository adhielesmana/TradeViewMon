import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusIndicator } from "@/components/status-indicator";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SystemStatusCardProps {
  title: string;
  status: "healthy" | "degraded" | "error" | "offline";
  lastCheck?: string | Date;
  lastSuccess?: string | Date | null;
  errorMessage?: string | null;
  icon?: LucideIcon;
  metadata?: Record<string, any>;
  className?: string;
}

export function SystemStatusCard({
  title,
  status,
  lastCheck,
  lastSuccess,
  errorMessage,
  icon: Icon,
  metadata,
  className,
}: SystemStatusCardProps) {
  const statusLabels = {
    healthy: "Operational",
    degraded: "Degraded",
    error: "Error",
    offline: "Offline",
  };

  const statusColors = {
    healthy: "text-profit",
    degraded: "text-yellow-500",
    error: "text-loss",
    offline: "text-neutral",
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            {Icon && <Icon className="h-4 w-4" />}
            {title}
          </CardTitle>
          <StatusIndicator status={status} pulse={status === "healthy"} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <span className={cn("text-sm font-medium", statusColors[status])}>
              {statusLabels[status]}
            </span>
          </div>

          {lastCheck && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Check</span>
              <span className="text-sm font-mono">
                {formatDistanceToNow(new Date(lastCheck), { addSuffix: true })}
              </span>
            </div>
          )}

          {lastSuccess && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Success</span>
              <span className="text-sm font-mono">
                {formatDistanceToNow(new Date(lastSuccess), { addSuffix: true })}
              </span>
            </div>
          )}

          {metadata && Object.keys(metadata).length > 0 && (
            <div className="border-t border-border pt-3 mt-3">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono">
                    {typeof value === 'number' ? value.toLocaleString() : String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {errorMessage && (
            <div className="mt-2 rounded-md bg-loss-muted p-2">
              <p className="text-xs text-loss">{errorMessage}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
