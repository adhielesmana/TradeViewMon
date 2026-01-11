import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
  BarChart2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  HardDrive,
  Zap,
  Image,
  Brain
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { SystemStatus } from "@shared/schema";

interface PriceUpdate {
  symbol: string;
  displayName: string;
  price: number;
  lastUpdate: string | null;
  ageSeconds: number | null;
  status: "fresh" | "stale" | "old" | "no_data" | "error";
}

interface ApiConfig {
  configured: boolean;
  description: string;
}

interface Diagnostics {
  timestamp: string;
  scheduler: {
    status: string;
    lastRun: string | null;
    interval: string;
  };
  database: {
    connected: boolean;
    latency: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  apis: {
    goldApi: ApiConfig;
    finnhub: ApiConfig;
    openai: ApiConfig;
    pexels: ApiConfig;
  };
  priceUpdates: PriceUpdate[];
  environment: string;
}

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

  const { data: diagnostics, isLoading: isLoadingDiagnostics } = useQuery<Diagnostics>({
    queryKey: ["/api/system/diagnostics"],
    refetchInterval: 15000,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "fresh":
        return <Badge variant="outline" className="text-profit border-profit/50"><CheckCircle className="mr-1 h-3 w-3" />Fresh</Badge>;
      case "stale":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-500/50 dark:text-yellow-400"><AlertTriangle className="mr-1 h-3 w-3" />Stale</Badge>;
      case "old":
        return <Badge variant="outline" className="text-loss border-loss/50"><XCircle className="mr-1 h-3 w-3" />Old</Badge>;
      case "no_data":
        return <Badge variant="outline" className="text-muted-foreground"><XCircle className="mr-1 h-3 w-3" />No Data</Badge>;
      default:
        return <Badge variant="outline" className="text-loss border-loss/50"><XCircle className="mr-1 h-3 w-3" />Error</Badge>;
    }
  };

  const formatAge = (seconds: number | null) => {
    if (seconds === null) return "Never";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

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

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">API Configuration</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingDiagnostics ? (
            <Skeleton className="h-24 w-full" />
          ) : diagnostics ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Wifi className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Gold-API</span>
                  <span className="text-xs text-muted-foreground">{diagnostics.apis.goldApi.description}</span>
                  <Badge variant="outline" className="mt-1 w-fit text-profit border-profit/50">
                    <CheckCircle className="mr-1 h-3 w-3" />Active
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <BarChart2 className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Finnhub</span>
                  <span className="text-xs text-muted-foreground">{diagnostics.apis.finnhub.description}</span>
                  {diagnostics.apis.finnhub.configured ? (
                    <Badge variant="outline" className="mt-1 w-fit text-profit border-profit/50">
                      <CheckCircle className="mr-1 h-3 w-3" />Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mt-1 w-fit text-yellow-600 border-yellow-500/50">
                      <AlertTriangle className="mr-1 h-3 w-3" />Not Set
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Brain className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">OpenAI</span>
                  <span className="text-xs text-muted-foreground">{diagnostics.apis.openai.description}</span>
                  {diagnostics.apis.openai.configured ? (
                    <Badge variant="outline" className="mt-1 w-fit text-profit border-profit/50">
                      <CheckCircle className="mr-1 h-3 w-3" />Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mt-1 w-fit text-yellow-600 border-yellow-500/50">
                      <AlertTriangle className="mr-1 h-3 w-3" />Not Set
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Image className="h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Pexels</span>
                  <span className="text-xs text-muted-foreground">{diagnostics.apis.pexels.description}</span>
                  {diagnostics.apis.pexels.configured ? (
                    <Badge variant="outline" className="mt-1 w-fit text-profit border-profit/50">
                      <CheckCircle className="mr-1 h-3 w-3" />Configured
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="mt-1 w-fit text-yellow-600 border-yellow-500/50">
                      <AlertTriangle className="mr-1 h-3 w-3" />Not Set
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">Sign in as admin to view API status</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">System Resources</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingDiagnostics ? (
            <Skeleton className="h-16 w-full" />
          ) : diagnostics ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground">Database</span>
                <span className={`text-lg font-medium ${diagnostics.database.connected ? "text-profit" : "text-loss"}`}>
                  {diagnostics.database.connected ? "Connected" : "Disconnected"}
                </span>
                <span className="text-xs text-muted-foreground">{diagnostics.database.latency}ms latency</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground">Memory (Heap)</span>
                <span className="text-lg font-medium font-mono">{diagnostics.memory.heapUsed} MB</span>
                <span className="text-xs text-muted-foreground">of {diagnostics.memory.heapTotal} MB</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground">Memory (RSS)</span>
                <span className="text-lg font-medium font-mono">{diagnostics.memory.rss} MB</span>
                <span className="text-xs text-muted-foreground">total process</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-muted-foreground">Environment</span>
                <span className="text-lg font-medium">{diagnostics.environment}</span>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">Sign in as admin to view system resources</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-medium">Price Data Freshness</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingDiagnostics ? (
            <Skeleton className="h-32 w-full" />
          ) : diagnostics?.priceUpdates ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">Symbol</th>
                    <th className="text-right py-2 px-2 font-medium">Price</th>
                    <th className="text-right py-2 px-2 font-medium">Last Update</th>
                    <th className="text-center py-2 px-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.priceUpdates.map((item) => (
                    <tr key={item.symbol} className="border-b border-border/50">
                      <td className="py-2 px-2">
                        <div className="flex flex-col">
                          <span className="font-medium">{item.symbol}</span>
                          <span className="text-xs text-muted-foreground">{item.displayName}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {item.price > 0 ? item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                      </td>
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        {formatAge(item.ageSeconds)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {getStatusBadge(item.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">Sign in as admin to view price data</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
