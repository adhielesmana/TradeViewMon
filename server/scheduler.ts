import cron from "node-cron";
import { storage } from "./storage";
import { predictionEngine } from "./prediction-engine";
import { marketDataService } from "./market-data-service";
import { wsService } from "./websocket";

const TIMEFRAMES = [
  { name: "1min", minutes: 1, dataPoints: 60, stepsAhead: 1 },
  { name: "5min", minutes: 5, dataPoints: 100, stepsAhead: 1 },
];

interface AggregatedCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function aggregateCandles(candles: any[], intervalMinutes: number): AggregatedCandle[] {
  if (candles.length === 0 || intervalMinutes <= 1) {
    return candles.map(c => ({
      timestamp: new Date(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  }

  const sortedCandles = [...candles].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const aggregated: AggregatedCandle[] = [];
  const intervalMs = intervalMinutes * 60 * 1000;
  
  let currentBucket: any[] = [];
  let bucketStart: number | null = null;
  
  for (const candle of sortedCandles) {
    const candleTime = new Date(candle.timestamp).getTime();
    const candleBucket = Math.floor(candleTime / intervalMs) * intervalMs;
    
    if (bucketStart === null) {
      bucketStart = candleBucket;
    }
    
    if (candleBucket === bucketStart) {
      currentBucket.push(candle);
    } else {
      if (currentBucket.length > 0) {
        aggregated.push({
          timestamp: new Date(bucketStart),
          open: currentBucket[0].open,
          high: Math.max(...currentBucket.map(c => c.high)),
          low: Math.min(...currentBucket.map(c => c.low)),
          close: currentBucket[currentBucket.length - 1].close,
          volume: currentBucket.reduce((sum, c) => sum + c.volume, 0),
        });
      }
      bucketStart = candleBucket;
      currentBucket = [candle];
    }
  }
  
  if (currentBucket.length > 0 && bucketStart !== null) {
    aggregated.push({
      timestamp: new Date(bucketStart),
      open: currentBucket[0].open,
      high: Math.max(...currentBucket.map(c => c.high)),
      low: Math.min(...currentBucket.map(c => c.low)),
      close: currentBucket[currentBucket.length - 1].close,
      volume: currentBucket.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  
  return aggregated;
}

class Scheduler {
  private isRunning: boolean = false;
  private task: cron.ScheduledTask | null = null;
  private intervalMs: number = 60000;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[Scheduler] Already running");
      return;
    }

    console.log("[Scheduler] Starting scheduler...");
    this.isRunning = true;

    await this.updateStatus("running");

    await this.initializeData();

    this.task = cron.schedule("* * * * *", async () => {
      await this.runCycle();
    });

    console.log("[Scheduler] Scheduler started - running every minute");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log("[Scheduler] Already stopped");
      return;
    }

    if (this.task) {
      this.task.stop();
      this.task = null;
    }

    this.isRunning = false;
    await this.updateStatus("stopped");
    console.log("[Scheduler] Scheduler stopped");
  }

  private async initializeData(): Promise<void> {
    try {
      const existingData = await storage.getRecentMarketData(
        marketDataService.getSymbol(),
        1
      );

      if (existingData.length === 0) {
        console.log("[Scheduler] No existing data found, generating initial data...");
        const historicalData = await marketDataService.generateHistoricalData(7);
        
        const batchSize = 100;
        for (let i = 0; i < historicalData.length; i += batchSize) {
          const batch = historicalData.slice(i, i + batchSize);
          await storage.insertMarketDataBatch(batch);
        }
        console.log(`[Scheduler] Generated ${historicalData.length} historical data points`);
      }

      await this.runCycle();
    } catch (error) {
      console.error("[Scheduler] Error initializing data:", error);
    }
  }

  private async runCycle(): Promise<void> {
    const symbol = marketDataService.getSymbol();

    try {
      await this.updateApiStatus("healthy");

      const candle = await marketDataService.fetchLatestCandle();
      await storage.insertMarketData(candle);

      const recentData = await storage.getRecentMarketData(symbol, 60);
      const stats = await storage.getMarketStats(symbol);

      wsService.broadcastMarketUpdate(symbol, {
        candle,
        stats,
        recentCount: recentData.length,
      });
      
      if (recentData.length >= 15) {
        const now = new Date();
        const newPredictions: Array<{
          timeframe: string;
          predictedPrice: number;
          predictedDirection: string;
          confidence: number;
        }> = [];

        for (const timeframe of TIMEFRAMES) {
          const dataNeeded = timeframe.dataPoints;
          const timeframeData = await storage.getRecentMarketData(symbol, dataNeeded);
          
          const aggregatedData = aggregateCandles(timeframeData, timeframe.minutes);
          
          if (aggregatedData.length < 10) {
            continue;
          }
          
          const prediction = predictionEngine.predict(aggregatedData as any, timeframe.stepsAhead);
          
          const targetTime = new Date(now.getTime() + timeframe.minutes * 60000);
          targetTime.setSeconds(0, 0);

          await storage.insertPrediction({
            symbol,
            predictionTimestamp: now,
            targetTimestamp: targetTime,
            predictedPrice: prediction.predictedPrice,
            predictedDirection: prediction.predictedDirection,
            modelType: prediction.modelType,
            confidence: prediction.confidence,
            timeframe: timeframe.name,
          });

          newPredictions.push({
            timeframe: timeframe.name,
            predictedPrice: prediction.predictedPrice,
            predictedDirection: prediction.predictedDirection,
            confidence: prediction.confidence,
          });
        }

        if (newPredictions.length > 0) {
          wsService.broadcastPredictionUpdate(symbol, { predictions: newPredictions });
        }

        await this.evaluatePastPredictions(symbol);
        await this.updatePredictionEngineStatus("healthy");
      }

      await this.updateStatus("running", new Date());
      
    } catch (error) {
      console.error("[Scheduler] Error in cycle:", error);
      await this.updateApiStatus("error", String(error));
    }
  }

  private async evaluatePastPredictions(symbol: string): Promise<void> {
    try {
      const now = new Date();
      let evaluatedCount = 0;

      for (const timeframe of TIMEFRAMES) {
        const predictions = await storage.getRecentPredictions(symbol, 20, timeframe.name);

        for (const pred of predictions) {
          if (pred.actualPrice !== undefined) continue;

          const targetTime = new Date(pred.targetTimestamp);
          if (targetTime > now) continue;

          const windowMinutes = timeframe.minutes + 2;
          const startTime = new Date(targetTime.getTime() - windowMinutes * 60000);
          const endTime = new Date(targetTime.getTime() + windowMinutes * 60000);
          const actualData = await storage.getMarketDataByTimeRange(symbol, startTime, endTime);
          
          if (actualData.length === 0) continue;

          const closest = actualData.reduce((prev, curr) => {
            const prevDiff = Math.abs(new Date(prev.timestamp).getTime() - targetTime.getTime());
            const currDiff = Math.abs(new Date(curr.timestamp).getTime() - targetTime.getTime());
            return currDiff < prevDiff ? curr : prev;
          });

          const comparison = predictionEngine.compareWithActual(
            pred.predictedPrice,
            closest.close
          );

          await storage.insertAccuracyResult({
            predictionId: pred.id,
            symbol,
            timestamp: new Date(pred.targetTimestamp),
            predictedPrice: pred.predictedPrice,
            actualPrice: closest.close,
            priceDifference: comparison.priceDifference,
            percentageDifference: comparison.percentageDifference,
            isMatch: comparison.isMatch,
            matchThreshold: 0.5,
          });
          
          evaluatedCount++;
        }
      }
      
      if (evaluatedCount > 0) {
        const accuracy = await storage.getAccuracyStats(symbol);
        wsService.broadcastAccuracyUpdate(symbol, {
          evaluatedCount,
          accuracy,
        });
      }
    } catch (error) {
      console.error("[Scheduler] Error evaluating predictions:", error);
    }
  }

  private async updateStatus(status: string, lastSuccess?: Date): Promise<void> {
    try {
      await storage.upsertSystemStatus({
        component: "scheduler",
        status: status as any,
        lastCheck: new Date(),
        lastSuccess: lastSuccess || null,
        errorMessage: null,
        metadata: JSON.stringify({ interval: "60s" }),
      });
    } catch (error) {
      console.error("[Scheduler] Error updating status:", error);
    }
  }

  private async updateApiStatus(status: string, error?: string): Promise<void> {
    try {
      await storage.upsertSystemStatus({
        component: "api",
        status: status as any,
        lastCheck: new Date(),
        lastSuccess: status === "healthy" ? new Date() : null,
        errorMessage: error || null,
        metadata: JSON.stringify({ endpoint: "market_data" }),
      });
    } catch (error) {
      console.error("[Scheduler] Error updating API status:", error);
    }
  }

  private async updatePredictionEngineStatus(status: string): Promise<void> {
    try {
      await storage.upsertSystemStatus({
        component: "prediction_engine",
        status: status as any,
        lastCheck: new Date(),
        lastSuccess: status === "healthy" ? new Date() : null,
        errorMessage: null,
        metadata: JSON.stringify({ model: "ensemble_ma_lr" }),
      });
    } catch (error) {
      console.error("[Scheduler] Error updating prediction engine status:", error);
    }
  }

  getStatus(): { isRunning: boolean; interval: number } {
    return {
      isRunning: this.isRunning,
      interval: this.intervalMs,
    };
  }
}

export const scheduler = new Scheduler();
