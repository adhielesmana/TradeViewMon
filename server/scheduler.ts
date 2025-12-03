import cron from "node-cron";
import { storage } from "./storage";
import { predictionEngine } from "./prediction-engine";
import { marketDataService } from "./market-data-service";
import { wsService } from "./websocket";
import { generateAiSuggestion, toInsertSuggestion, evaluateSuggestion } from "./ai-suggestion-engine";

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
  private intervalHandle: NodeJS.Timeout | null = null;
  private predictionTask: ReturnType<typeof cron.schedule> | null = null;
  private currencyTask: ReturnType<typeof cron.schedule> | null = null;
  private intervalMs: number = 60000;
  private predictionCycleCount: number = 0;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[Scheduler] Already running");
      return;
    }

    console.log("[Scheduler] Starting scheduler...");
    this.isRunning = true;

    await this.updateStatus("running");

    await this.initializeData();
    
    // Initialize currency rates on startup
    await this.initializeCurrencyRates();

    this.predictionTask = cron.schedule("0 * * * * *", async () => {
      await this.runCycle();
      await this.runPredictionCycle();
      await this.runAiSuggestionCycle();
    });

    // Update currency rates every 12 hours (at minute 0 of hours 0 and 12)
    this.currencyTask = cron.schedule("0 0 0,12 * * *", async () => {
      await this.updateCurrencyRates();
    });

    console.log("[Scheduler] Scheduler started - running every 60 seconds for market data and predictions");
    console.log("[Scheduler] Currency rates will update every 12 hours");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log("[Scheduler] Already stopped");
      return;
    }

    if (this.predictionTask) {
      this.predictionTask.stop();
      this.predictionTask = null;
    }

    if (this.currencyTask) {
      this.currencyTask.stop();
      this.currencyTask = null;
    }

    this.isRunning = false;
    await this.updateStatus("stopped");
    console.log("[Scheduler] Scheduler stopped");
  }

  private async initializeCurrencyRates(): Promise<void> {
    try {
      const { currencyService } = await import("./currency-service");
      const rates = await storage.getAllCurrencyRates();
      
      if (rates.length === 0) {
        console.log("[Scheduler] No currency rates found, fetching initial rates...");
        await currencyService.updateRates();
      } else {
        const lastUpdate = rates[0]?.fetchedAt;
        const hoursSinceUpdate = lastUpdate 
          ? (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60)
          : Infinity;
        
        if (hoursSinceUpdate > 12) {
          console.log(`[Scheduler] Currency rates are ${hoursSinceUpdate.toFixed(1)} hours old, refreshing...`);
          await currencyService.updateRates();
        } else {
          console.log(`[Scheduler] Currency rates are ${hoursSinceUpdate.toFixed(1)} hours old (next update at 12 hours)`);
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error initializing currency rates:", error);
    }
  }

  private async updateCurrencyRates(): Promise<void> {
    try {
      console.log("[Scheduler] Running scheduled currency rate update...");
      const { currencyService } = await import("./currency-service");
      await currencyService.updateRates();
      console.log("[Scheduler] Currency rates updated successfully");
    } catch (error) {
      console.error("[Scheduler] Error updating currency rates:", error);
    }
  }

  private async initializeData(): Promise<void> {
    try {
      const symbol = marketDataService.getSymbol();
      const existingData = await storage.getRecentMarketData(symbol, 1);

      if (existingData.length === 0) {
        console.log("[Scheduler] No existing data found, generating initial 1-hour data...");
        const historicalData = await marketDataService.generateHistoricalData(1);
        
        const batchSize = 500;
        for (let i = 0; i < historicalData.length; i += batchSize) {
          const batch = historicalData.slice(i, i + batchSize);
          await storage.insertMarketDataBatch(batch);
        }
        
        if (historicalData.length > 0) {
          const lastCandle = historicalData[historicalData.length - 1];
          await storage.upsertPriceState(symbol, lastCandle.open, lastCandle.close, lastCandle.timestamp);
          console.log(`[Scheduler] Saved initial price state: open=${lastCandle.open}, close=${lastCandle.close}`);
        }
        
        console.log(`[Scheduler] Generated ${historicalData.length} historical data points (1-minute candles)`);
      } else {
        const lastCandle = existingData[0];
        const savedState = await storage.getPriceState(symbol);
        if (!savedState) {
          await storage.upsertPriceState(symbol, lastCandle.open, lastCandle.close, lastCandle.timestamp);
          console.log(`[Scheduler] Restored price state from existing data: close=${lastCandle.close}`);
        }
      }

      await this.runCycle();
    } catch (error) {
      console.error("[Scheduler] Error initializing data:", error);
    }
  }

  private async runCycle(): Promise<void> {
    const allSymbols = marketDataService.getSupportedSymbols();

    try {
      await this.updateApiStatus("healthy");

      // Process all symbols - fetch market data for each
      for (const symbol of allSymbols) {
        try {
          const savedPriceState = await storage.getPriceState(symbol);
          let lastClosePrice: number | undefined;
          
          if (savedPriceState) {
            lastClosePrice = savedPriceState.lastClose;
          } else {
            const lastData = await storage.getRecentMarketData(symbol, 1);
            lastClosePrice = lastData.length > 0 ? lastData[0].close : undefined;
          }

          const candle = await marketDataService.fetchLatestCandle(symbol, lastClosePrice);
          await storage.insertMarketData(candle);
          
          await storage.upsertPriceState(symbol, candle.open, candle.close, candle.timestamp);

          const recentData = await storage.getRecentMarketData(symbol, 60);
          const stats = await storage.getMarketStats(symbol);

          wsService.broadcastMarketUpdate(symbol, {
            candle,
            stats,
            recentCount: recentData.length,
          });
          
          // Small delay between API calls to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (symbolError) {
          console.error(`[Scheduler] Error fetching ${symbol}:`, symbolError);
        }
      }

      await this.updateStatus("running", new Date());
      
    } catch (error) {
      console.error("[Scheduler] Error in cycle:", error);
      await this.updateApiStatus("error", String(error));
    }
  }

  private async runPredictionCycle(): Promise<void> {
    const allSymbols = marketDataService.getSupportedSymbols();

    try {
      for (const symbol of allSymbols) {
        const recentData = await storage.getRecentMarketData(symbol, 300);
        
        // Skip symbols with insufficient data
        if (recentData.length < 60) {
          continue;
        }
        
        const now = new Date();
        const newPredictions: Array<{
          timeframe: string;
          predictedPrice: number;
          predictedDirection: string;
          confidence: number;
        }> = [];

        for (const timeframe of TIMEFRAMES) {
          const dataNeeded = timeframe.dataPoints * 60;
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
      }
      
      await this.updatePredictionEngineStatus("healthy");
    } catch (error) {
      console.error("[Scheduler] Error in prediction cycle:", error);
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
        metadata: JSON.stringify({ interval: "1s" }),
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

  private async runAiSuggestionCycle(): Promise<void> {
    const allSymbols = marketDataService.getSupportedSymbols();
    let successCount = 0;
    let lastDecision = "";
    let lastConfidence = 0;

    try {
      for (const symbol of allSymbols) {
        const recentData = await storage.getRecentMarketData(symbol, 100);
        
        // Skip symbols with insufficient data
        if (recentData.length < 30) {
          continue;
        }
        
        const suggestion = generateAiSuggestion(recentData, symbol);
        const insertData = toInsertSuggestion(suggestion, symbol);
        
        const savedSuggestion = await storage.insertAiSuggestion(insertData);
        
        console.log(`[Scheduler] AI Suggestion: ${suggestion.decision} for ${symbol} (confidence: ${suggestion.confidence}%)`);

        wsService.broadcast({
          type: "suggestion_update",
          symbol,
          data: {
            id: savedSuggestion.id,
            decision: suggestion.decision,
            confidence: suggestion.confidence,
            buyTarget: suggestion.buyTarget,
            sellTarget: suggestion.sellTarget,
            currentPrice: suggestion.currentPrice,
            reasoning: suggestion.reasoning,
          },
        });

        successCount++;
        lastDecision = suggestion.decision;
        lastConfidence = suggestion.confidence;
      }
      
      // Process auto-trades based on AI suggestions
      await this.processAutoTrades();
      
      // Evaluate past suggestions for all symbols
      await this.evaluateAiSuggestions();
      
      if (successCount > 0) {
        await storage.upsertSystemStatus({
          component: "ai_suggestions",
          status: "healthy",
          lastCheck: new Date(),
          lastSuccess: new Date(),
          errorMessage: null,
          metadata: JSON.stringify({ 
            symbolsProcessed: successCount,
            lastDecision,
            lastConfidence 
          }),
        });
      }
    } catch (error) {
      console.error("[Scheduler] Error in AI suggestion cycle:", error);
      await storage.upsertSystemStatus({
        component: "ai_suggestions",
        status: "error",
        lastCheck: new Date(),
        lastSuccess: null,
        errorMessage: String(error),
        metadata: null,
      });
    }
  }

  private async processAutoTrades(): Promise<void> {
    try {
      const enabledSettings = await storage.getAllEnabledAutoTradeSettings();
      
      for (const settings of enabledSettings) {
        try {
          // Get the latest AI suggestion for the configured symbol
          const suggestion = await storage.getLatestAiSuggestion(settings.symbol);
          
          if (!suggestion) {
            continue;
          }
          
          // Only trade on BUY or SELL, HOLD does nothing
          if (suggestion.decision === "HOLD") {
            continue;
          }
          
          // Check if we already traded on this suggestion (avoid duplicate trades)
          if (settings.lastTradeAt && suggestion.createdAt) {
            const suggestionTime = new Date(suggestion.createdAt).getTime();
            const lastTradeTime = new Date(settings.lastTradeAt).getTime();
            
            // Skip if we already traded within the last 30 seconds after this suggestion
            if (lastTradeTime >= suggestionTime - 30000) {
              continue;
            }
          }
          
          // Get user's demo account
          const account = await storage.getDemoAccount(settings.userId);
          
          if (!account) {
            console.log(`[AutoTrade] No demo account for user ${settings.userId}`);
            continue;
          }
          
          // Use trade units (lot size) directly - user specifies quantity
          const tradeUnits = settings.tradeUnits;
          const currentPrice = suggestion.currentPrice;
          
          // Calculate required USD for this trade (units × price)
          const requiredUsd = tradeUnits * currentPrice;
          
          // Check if user has sufficient balance
          if (account.balance < requiredUsd) {
            console.log(`[AutoTrade] Insufficient balance for user ${settings.userId}: $${account.balance.toFixed(2)} < $${requiredUsd.toFixed(2)} (${tradeUnits} units @ $${currentPrice.toFixed(2)})`);
            continue;
          }
          
          // Use the trade units directly as quantity
          const quantity = tradeUnits;
          
          // Open the trade with isAutoTrade flag
          const tradeType = suggestion.decision as 'BUY' | 'SELL';
          const result = await storage.openDemoTrade(
            settings.userId,
            settings.symbol,
            tradeType,
            currentPrice,
            quantity,
            undefined, // stopLoss
            undefined, // takeProfit
            true // isAutoTrade
          );
          
          if (result) {
            // Record the auto-trade
            await storage.recordAutoTrade(settings.userId, suggestion.decision);
            
            console.log(`[AutoTrade] Executed ${tradeType} trade for user ${settings.userId}: ${quantity.toFixed(6)} ${settings.symbol} @ $${currentPrice.toFixed(2)}`);
            
            // Broadcast auto-trade event via WebSocket
            wsService.broadcast({
              type: "auto_trade_executed",
              userId: settings.userId,
              data: {
                symbol: settings.symbol,
                decision: suggestion.decision,
                quantity,
                price: currentPrice,
                tradeValueUsd: requiredUsd,
              },
            });
          }
        } catch (userError) {
          console.error(`[AutoTrade] Error processing auto-trade for user ${settings.userId}:`, userError);
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error in auto-trade processing:", error);
    }
  }

  private async evaluateAiSuggestions(): Promise<void> {
    try {
      const unevaluatedSuggestions = await storage.getUnevaluatedSuggestions(20);
      const evaluatedSymbols = new Set<string>();
      
      for (const suggestion of unevaluatedSuggestions) {
        const latestData = await storage.getLatestMarketData(suggestion.symbol);
        if (!latestData) continue;
        
        const evaluation = evaluateSuggestion(
          {
            decision: suggestion.decision,
            currentPrice: suggestion.currentPrice,
            buyTarget: suggestion.buyTarget,
            sellTarget: suggestion.sellTarget,
          },
          latestData.close
        );
        
        await storage.evaluateAiSuggestion(
          suggestion.id,
          latestData.close,
          evaluation.wasAccurate,
          evaluation.profitLoss
        );
        
        evaluatedSymbols.add(suggestion.symbol);
        console.log(`[Scheduler] Evaluated suggestion #${suggestion.id}: ${evaluation.wasAccurate ? 'Accurate' : 'Inaccurate'} (${evaluation.profitLoss.toFixed(2)}%)`);
      }
      
      // Broadcast accuracy updates for each symbol that had suggestions evaluated
      const symbolsArray = Array.from(evaluatedSymbols);
      for (const symbol of symbolsArray) {
        const accuracy = await storage.getAiSuggestionAccuracyStats(symbol);
        wsService.broadcast({
          type: "suggestion_accuracy_update",
          symbol,
          data: accuracy,
        });
      }
    } catch (error) {
      console.error("[Scheduler] Error evaluating AI suggestions:", error);
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
