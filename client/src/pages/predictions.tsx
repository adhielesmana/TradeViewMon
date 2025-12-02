import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PredictionChart } from "@/components/prediction-chart";
import { PredictionTable } from "@/components/prediction-table";
import { AccuracyDisplay } from "@/components/accuracy-display";
import { StatCard } from "@/components/stat-card";
import { ExportDropdown } from "@/components/export-dropdown";
import { TimeframeSelector } from "@/components/timeframe-selector";
import { Target, TrendingUp, Clock, BarChart2 } from "lucide-react";
import { useSymbol } from "@/lib/symbol-context";
import type { PredictionWithResult, AccuracyStats } from "@shared/schema";

export default function Predictions() {
  const { currentSymbol } = useSymbol();
  const symbol = currentSymbol.symbol;
  const [timeframe, setTimeframe] = useState("all");

  const timeframeParam = timeframe === "all" ? undefined : timeframe;

  const { data: predictions, isLoading: isLoadingPredictions } = useQuery<PredictionWithResult[]>({
    queryKey: ["/api/predictions/recent", { symbol, timeframe: timeframeParam }],
    refetchInterval: 30000,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<AccuracyStats>({
    queryKey: ["/api/predictions/accuracy", { symbol, timeframe: timeframeParam }],
    refetchInterval: 30000,
  });

  const defaultStats: AccuracyStats = {
    totalPredictions: 0,
    matchCount: 0,
    notMatchCount: 0,
    accuracyPercent: 0,
    averageError: 0,
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Predictions</h1>
          <p className="text-sm text-muted-foreground">
            AI-powered price predictions with accuracy tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          <ExportDropdown 
            endpoint="/api/export/predictions"
            filename={`${symbol}_predictions_${timeframe}`}
            params={{ symbol, ...(timeframeParam && { timeframe: timeframeParam }) }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Predictions"
          value={stats?.totalPredictions || 0}
          icon={BarChart2}
          testId="text-total-predictions-card"
        />
        <StatCard
          label="Matches"
          value={stats?.matchCount || 0}
          icon={Target}
          valueClassName="text-profit"
          testId="text-matches-card"
        />
        <StatCard
          label="Misses"
          value={stats?.notMatchCount || 0}
          icon={TrendingUp}
          valueClassName="text-loss"
          testId="text-misses-card"
        />
        <StatCard
          label="Avg Error"
          value={`${(stats?.averageError || 0).toFixed(2)}%`}
          icon={Clock}
          testId="text-avg-error-card"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PredictionChart
            predictions={predictions || []}
            isLoading={isLoadingPredictions}
            height={350}
          />
        </div>
        <div className="lg:col-span-1">
          <AccuracyDisplay
            stats={stats || defaultStats}
            isLoading={isLoadingStats}
          />
        </div>
      </div>

      <PredictionTable
        predictions={predictions || []}
        isLoading={isLoadingPredictions}
        maxHeight={450}
      />
    </div>
  );
}
