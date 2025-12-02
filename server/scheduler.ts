import cron from "node-cron";
import { storage } from "./storage";
import { predictionEngine } from "./prediction-engine";
import { marketDataService } from "./market-data-service";

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

      const recentData = await storage.getRecentMarketData(symbol, 30);
      
      if (recentData.length >= 5) {
        const prediction = predictionEngine.predict(recentData);
        
        const now = new Date();
        const targetTime = new Date(now.getTime() + 60000);
        targetTime.setSeconds(0, 0);

        const savedPrediction = await storage.insertPrediction({
          symbol,
          predictionTimestamp: now,
          targetTimestamp: targetTime,
          predictedPrice: prediction.predictedPrice,
          predictedDirection: prediction.predictedDirection,
          modelType: prediction.modelType,
          confidence: prediction.confidence,
        });

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
      const predictions = await storage.getRecentPredictions(symbol, 20);
      const now = new Date();

      for (const pred of predictions) {
        if (pred.actualPrice !== undefined) continue;

        const targetTime = new Date(pred.targetTimestamp);
        if (targetTime > now) continue;

        const actualData = await storage.getRecentMarketData(symbol, 5);
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
