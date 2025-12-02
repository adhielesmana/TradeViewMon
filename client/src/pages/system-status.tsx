import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SystemStatusCard } from "@/components/system-status-card";
import { StatCard } from "@/components/stat-card";
import { 
  Activity, 
  Database, 
  Clock, 
  Cpu, 
  Wifi, 
  RefreshCw,
  Server,
  BarChart2
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { SystemStatus } from "@shared/schema";

interface SystemStats {
  totalRecords: number;
  totalPredictions: number;
  schedulerStatus: "running" | "stopped";
  lastSchedulerRun: string | null;
  uptime: number;
}

export default function SystemStatusPage() {
  const { data: statusList, isLoading: isLoadingStatus } = useQuery<SystemStatus[]>({
    queryKey: ["/api/system/status"],
    refetchInterval: 10000,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<SystemStats>({
    queryKey: ["/api/system/stats"],
    refetchInterval: 10000,
  });

  const getComponentIcon = (component: string) => {
    switch (component.toLowerCase()) {
      case "api":
        return Wifi;
      case "database":
        return Database;
      case "scheduler":
        return RefreshCw;
      case "prediction_engine":
        return Cpu;
      default:
        return Server;
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">System Status</h1>
        <p className="text-sm text-muted-foreground">
          Monitor system health, API status, and scheduler activity
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoadingStats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : stats ? (
          <>
            <StatCard
              label="Total Records"
              value={stats.totalRecords.toLocaleString()}
              icon={Database}
              testId="text-total-records"
            />
            <StatCard
              label="Total Predictions"
              value={stats.totalPredictions.toLocaleString()}
              icon={BarChart2}
              testId="text-total-predictions-status"
            />
            <StatCard
              label="Scheduler"
              value={stats.schedulerStatus === "running" ? "Active" : "Stopped"}
              icon={RefreshCw}
              valueClassName={stats.schedulerStatus === "running" ? "text-profit" : "text-loss"}
              testId="text-scheduler-status"
            />
            <StatCard
              label="Uptime"
              value={formatUptime(stats.uptime)}
              icon={Clock}
              testId="text-uptime"
            />
          </>
        ) : (
          <div className="col-span-4 text-center text-muted-foreground">
            No system stats available
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">Component Status</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingStatus ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : statusList && statusList.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {statusList.map((status) => (
                <SystemStatusCard
                  key={status.component}
                  title={status.component.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  status={status.status as "healthy" | "degraded" | "error"}
                  lastCheck={status.lastCheck}
                  lastSuccess={status.lastSuccess}
                  errorMessage={status.errorMessage}
                  icon={getComponentIcon(status.component)}
                  metadata={status.metadata ? JSON.parse(status.metadata) : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              No component status available
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">Scheduler Activity</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className={`text-lg font-medium ${stats?.schedulerStatus === "running" ? "text-profit" : "text-loss"}`}>
                {stats?.schedulerStatus === "running" ? "Running" : "Stopped"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Interval</span>
              <span className="text-lg font-medium">60 seconds</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Last Run</span>
              <span className="text-lg font-medium font-mono" data-testid="text-last-scheduler-run">
                {stats?.lastSchedulerRun 
                  ? formatDistanceToNow(new Date(stats.lastSchedulerRun), { addSuffix: true })
                  : "Never"
                }
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Next Run</span>
              <span className="text-lg font-medium">
                {stats?.schedulerStatus === "running" ? "~1 min" : "N/A"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
