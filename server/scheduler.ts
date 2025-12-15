import cron from "node-cron";
import { storage } from "./storage";
import { predictionEngine } from "./prediction-engine";
import { marketDataService } from "./market-data-service";
import { wsService } from "./websocket";
import { generateAiSuggestion, toInsertSuggestion, evaluateSuggestion } from "./ai-suggestion-engine";
import { analyzeWithAI } from "./ai-trading-analyzer";
import { generateUnifiedSignal } from "./unified-signal-generator";

// Market hours detection
// Forex/Precious metals market: Sunday 5 PM EST to Friday 5 PM EST
// Crypto (BTCUSD): 24/7
interface MarketStatus {
  isOpen: boolean;
  reason: string;
  nextOpenTime?: Date;
  nextCloseTime?: Date;
}

function isMarketOpen(symbol: string): MarketStatus {
  const now = new Date();
  
  // Convert to EST (UTC-5, accounting for DST is complex, using fixed offset)
  const utcHours = now.getUTCHours();
  const utcDay = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  
  // EST = UTC - 5 hours (standard time)
  // During DST (March-November), EST = UTC - 4 hours
  // For simplicity, use UTC-5 as a baseline
  const estHour = (utcHours - 5 + 24) % 24;
  const estDay = utcHours < 5 ? (utcDay + 6) % 7 : utcDay;
  
  // Crypto markets are 24/7
  if (symbol === "BTCUSD") {
    return {
      isOpen: true,
      reason: "Crypto markets are open 24/7",
    };
  }
  
  // Forex/Metals market hours:
  // Closed: Friday 5 PM EST to Sunday 5 PM EST
  // This means:
  // - Friday after 5 PM EST (17:00) = closed
  // - All day Saturday = closed
  // - Sunday before 5 PM EST (17:00) = closed
  
  const isClosed = 
    (estDay === 5 && estHour >= 17) ||  // Friday after 5 PM EST
    (estDay === 6) ||                    // All Saturday
    (estDay === 0 && estHour < 17);      // Sunday before 5 PM EST
  
  if (isClosed) {
    // Calculate next open time (Sunday 5 PM EST = 10 PM UTC)
    // We need to find the next Sunday 10 PM UTC
    const nextOpen = new Date(now);
    
    // Get current UTC day
    const currentUtcDay = now.getUTCDay(); // 0 = Sunday
    
    // Calculate days until next Sunday (in UTC terms)
    let daysUntilSunday: number;
    if (currentUtcDay === 0) {
      // It's Sunday in UTC - check if we're past 10 PM UTC
      if (now.getUTCHours() >= 22) {
        daysUntilSunday = 7; // Next Sunday
      } else {
        daysUntilSunday = 0; // This Sunday
      }
    } else {
      daysUntilSunday = 7 - currentUtcDay; // Days until Sunday
    }
    
    nextOpen.setUTCDate(now.getUTCDate() + daysUntilSunday);
    nextOpen.setUTCHours(22, 0, 0, 0); // 5 PM EST = 10 PM UTC (17 + 5 = 22)
    
    return {
      isOpen: false,
      reason: "Market closed for weekend (Friday 5PM - Sunday 5PM EST)",
      nextOpenTime: nextOpen,
    };
  }
  
  // Calculate next close time (Friday 5 PM EST)
  const daysUntilFriday = (5 - estDay + 7) % 7 || 7;
  const nextClose = new Date(now);
  nextClose.setUTCDate(now.getUTCDate() + (estDay === 5 ? 0 : daysUntilFriday));
  nextClose.setUTCHours(22, 0, 0, 0); // 5 PM EST = 10 PM UTC
  
  return {
    isOpen: true,
    reason: "Market is open",
    nextCloseTime: nextClose,
  };
}

// Track global market status for broadcasting
let currentMarketStatus: { [symbol: string]: MarketStatus } = {};

function getMarketStatus(symbol: string): MarketStatus {
  if (!currentMarketStatus[symbol]) {
    currentMarketStatus[symbol] = isMarketOpen(symbol);
  }
  return currentMarketStatus[symbol];
}

function updateAllMarketStatus(): void {
  const symbols = marketDataService.getSupportedSymbols();
  for (const symbol of symbols) {
    currentMarketStatus[symbol] = isMarketOpen(symbol);
  }
}

// Export market status functions for use in routes
export function getMarketStatusForSymbol(symbol: string): MarketStatus {
  return isMarketOpen(symbol);
}

export function getAllMarketStatuses(): { [symbol: string]: MarketStatus } {
  updateAllMarketStatus();
  return { ...currentMarketStatus };
}

// Pip value for each symbol (1 pip = this amount in price)
// Standard forex pip values based on instrument type
function getPipValue(symbol: string): number {
  switch (symbol) {
    case "XAUUSD": return 0.10;      // Gold: 1 pip = $0.10
    case "XAGUSD": return 0.01;      // Silver: 1 pip = $0.01
    case "BTCUSD": return 1.00;      // Bitcoin: 1 pip = $1.00
    case "DXY": return 0.01;         // Dollar Index: 1 pip = 0.01
    case "SPX": return 0.10;         // S&P 500: 1 pip = 0.10
    case "USOIL": return 0.01;       // Crude Oil: 1 pip = $0.01
    case "GDX": return 0.01;         // Gold Miners ETF: 1 pip = $0.01
    case "GDXJ": return 0.01;        // Junior Gold Miners: 1 pip = $0.01
    case "NEM": return 0.01;         // Newmont: 1 pip = $0.01
    case "US10Y": return 0.01;       // 10-Year Treasury: 1 pip = 0.01
    default: return 0.01;            // Default: 1 pip = $0.01
  }
}

// Calculate stop loss and take profit prices based on mode (pips, percentage, or atr)
// Default 1:2 ratio (SL:TP) but allows custom TP value
// ATR mode: SL = 1.5x ATR, TP = 3x ATR for better volatility adaptation
function calculateSlTpPrices(
  entryPrice: number,
  tradeType: 'BUY' | 'SELL',
  mode: string, // 'pips', 'percentage', or 'atr'
  stopLossValue: number, // pips, percentage, or ATR multiplier value
  symbol: string,
  takeProfitValue?: number, // optional custom TP value (defaults to 2x SL)
  atr?: number // ATR value for ATR mode
): { stopLoss: number | undefined; takeProfit: number | undefined } {
  if (!stopLossValue || stopLossValue <= 0) {
    return { stopLoss: undefined, takeProfit: undefined };
  }
  
  let slDistance: number;
  let tpDistance: number;
  
  if (mode === 'atr') {
    // ATR-based stop loss/take profit - adapts to market volatility
    // Default: SL = stopLossValue × ATR, TP = takeProfitValue × ATR (or 2x SL)
    if (!atr || atr <= 0) {
      console.log(`[SL/TP] ATR mode requested but no ATR available, falling back to percentage mode`);
      // Fallback to percentage mode if ATR not available
      slDistance = entryPrice * (stopLossValue / 100);
      const effectiveTpValue = takeProfitValue && takeProfitValue > 0 ? takeProfitValue : stopLossValue * 2;
      tpDistance = entryPrice * (effectiveTpValue / 100);
    } else {
      // Use ATR multipliers: SL = stopLossValue × ATR, TP = takeProfitValue × ATR
      slDistance = stopLossValue * atr;
      const effectiveTpMultiplier = takeProfitValue && takeProfitValue > 0 ? takeProfitValue : stopLossValue * 2;
      tpDistance = effectiveTpMultiplier * atr;
      console.log(`[SL/TP] ATR mode: ATR=${atr.toFixed(4)}, SL distance=${slDistance.toFixed(4)} (${stopLossValue}x), TP distance=${tpDistance.toFixed(4)} (${effectiveTpMultiplier}x)`);
    }
  } else if (mode === 'percentage') {
    // Calculate distance as percentage of entry price
    slDistance = entryPrice * (stopLossValue / 100);
    // Use custom TP value or default to 2x SL
    const effectiveTpValue = takeProfitValue && takeProfitValue > 0 ? takeProfitValue : stopLossValue * 2;
    tpDistance = entryPrice * (effectiveTpValue / 100);
  } else {
    // Calculate distance using pips
    const pipValue = getPipValue(symbol);
    slDistance = stopLossValue * pipValue;
    // Use custom TP value or default to 2x SL
    const effectiveTpValue = takeProfitValue && takeProfitValue > 0 ? takeProfitValue : stopLossValue * 2;
    tpDistance = effectiveTpValue * pipValue;
  }
  
  let stopLoss: number;
  let takeProfit: number;
  
  if (tradeType === 'BUY') {
    stopLoss = entryPrice - slDistance;
    takeProfit = entryPrice + tpDistance;
  } else {
    stopLoss = entryPrice + slDistance;
    takeProfit = entryPrice - tpDistance;
  }
  
  return { stopLoss, takeProfit };
}

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
    
    // Update all market status at the start of each cycle
    updateAllMarketStatus();

    try {
      await this.updateApiStatus("healthy");

      // Process all symbols - fetch market data for each
      for (const symbol of allSymbols) {
        try {
          const marketStatus = getMarketStatus(symbol);
          const savedPriceState = await storage.getPriceState(symbol);
          let lastClosePrice: number | undefined;
          
          if (savedPriceState) {
            lastClosePrice = savedPriceState.lastClose;
          } else {
            const lastData = await storage.getRecentMarketData(symbol, 1);
            lastClosePrice = lastData.length > 0 ? lastData[0].close : undefined;
          }

          let candle;
          
          if (marketStatus.isOpen) {
            // Market is OPEN - fetch real data from API
            candle = await marketDataService.fetchLatestCandle(symbol, lastClosePrice);
          } else {
            // Market is CLOSED - generate offline candle with last known price
            // This saves API calls and server resources during weekends
            if (!lastClosePrice) {
              console.log(`[Scheduler] ${symbol} market closed, no previous data to generate offline candle`);
              continue;
            }
            
            const now = new Date();
            now.setSeconds(0, 0);
            
            // Create a flat candle with last close price (no movement during market closure)
            candle = {
              symbol,
              timestamp: now,
              open: lastClosePrice,
              high: lastClosePrice,
              low: lastClosePrice,
              close: lastClosePrice,
              volume: 0, // No volume during market closure
              interval: "1min" as const,
            };
            
            // Log market closed status periodically (every 10 minutes)
            const minuteNow = now.getMinutes();
            if (minuteNow % 10 === 0) {
              console.log(`[Scheduler] ${symbol} MARKET CLOSED - using offline mode (price: $${lastClosePrice.toFixed(2)})`);
            }
          }
          
          await storage.insertMarketData(candle);
          await storage.upsertPriceState(symbol, candle.open, candle.close, candle.timestamp);

          // Check and update open positions - trigger stop loss / take profit if needed
          // Note: During market closure, prices don't move so no SL/TP will trigger
          await storage.updateOpenPositionPrices(symbol, candle.close);

          const recentData = await storage.getRecentMarketData(symbol, 60);
          const stats = await storage.getMarketStats(symbol);

          // Include market status in the broadcast
          wsService.broadcastMarketUpdate(symbol, {
            candle,
            stats,
            recentCount: recentData.length,
            marketStatus: {
              isOpen: marketStatus.isOpen,
              reason: marketStatus.reason,
              nextOpenTime: marketStatus.nextOpenTime?.toISOString(),
              nextCloseTime: marketStatus.nextCloseTime?.toISOString(),
            },
          });
          
          // Only delay between API calls if market is open (no delay needed for offline mode)
          if (marketStatus.isOpen) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
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
          timestamp: new Date().toISOString(),
          data: {
            id: savedSuggestion.id,
            decision: suggestion.decision,
            confidence: suggestion.confidence,
            buyTarget: suggestion.buyTarget,
            sellTarget: suggestion.sellTarget,
            currentPrice: suggestion.currentPrice,
            reasoning: suggestion.reasoning,
            tradePlan: suggestion.tradePlan,
            entryPrice: suggestion.tradePlan?.entryPrice,
            stopLoss: suggestion.tradePlan?.stopLoss,
            takeProfit1: suggestion.tradePlan?.takeProfit1,
            takeProfit2: suggestion.tradePlan?.takeProfit2,
            takeProfit3: suggestion.tradePlan?.takeProfit3,
            riskRewardRatio: suggestion.tradePlan?.riskRewardRatio,
            supportLevel: suggestion.tradePlan?.supportLevel,
            resistanceLevel: suggestion.tradePlan?.resistanceLevel,
            signalType: suggestion.tradePlan?.signalType,
            analysis: suggestion.tradePlan?.analysis,
          },
        });

        successCount++;
        lastDecision = suggestion.decision;
        lastConfidence = suggestion.confidence;
      }
      
      // Process auto-trades based on AI suggestions
      await this.processAutoTrades();
      
      // Process precision auto-trades with exact Entry/SL/TP from suggestions
      await this.processPrecisionTrades();
      
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
      console.log(`[AutoTrade] Processing ${enabledSettings.length} enabled auto-trade settings`);
      
      for (const settings of enabledSettings) {
        try {
          // Get the latest actionable (BUY/SELL) AI suggestion within the last 5 minutes
          // This prevents missing trade signals when newer HOLD suggestions exist
          const suggestion = await storage.getLatestActionableAiSuggestion(settings.symbol, 5);
          
          if (!suggestion) {
            // Only log every few cycles to reduce noise
            console.log(`[AutoTrade] No actionable BUY/SELL signal for ${settings.symbol} in last 5 minutes`);
            continue;
          }
          
          console.log(`[AutoTrade] Actionable signal for ${settings.symbol}: ${suggestion.decision} (confidence: ${suggestion.confidence}%, generated ${new Date(suggestion.generatedAt || 0).toISOString()})`)
          
          // Check if we already traded on this suggestion (avoid duplicate trades)
          if (settings.lastTradeAt && suggestion.generatedAt) {
            const suggestionTime = new Date(suggestion.generatedAt).getTime();
            const lastTradeTime = new Date(settings.lastTradeAt).getTime();
            
            // Skip if we already traded within the last 30 seconds after this suggestion
            if (lastTradeTime >= suggestionTime - 30000) {
              continue;
            }
          }
          
          // AI Filter: ONLY run when explicitly enabled via toggle
          // The minConfidence setting only affects the threshold when AI filter is ON
          const useAiFilter = settings.useAiFilter ?? false;
          const minConfidence = settings.minConfidence ?? 0;
          
          if (useAiFilter) {
            try {
              // Get recent candles for AI analysis
              const candles = await storage.getRecentMarketData(settings.symbol, 100);
              
              if (candles.length >= 30) {
                // Use user's configured minConfidence directly
                // When minConfidence is 0, AI can fall back to technical analysis if OpenAI fails
                const aiAnalysis = await analyzeWithAI(
                  settings.symbol,
                  candles,
                  minConfidence
                );
                
                // Skip trade if AI says not to trade
                if (!aiAnalysis.shouldTrade) {
                  console.log(`[AutoTrade] AI filter blocked trade for ${settings.symbol}: ${aiAnalysis.reasoning} (confidence: ${aiAnalysis.confidence}%)`);
                  continue;
                }
                
                // If AI direction differs from suggestion, skip
                if (aiAnalysis.direction !== suggestion.decision) {
                  console.log(`[AutoTrade] AI direction mismatch: AI says ${aiAnalysis.direction}, suggestion says ${suggestion.decision}`);
                  continue;
                }
                
                console.log(`[AutoTrade] AI approved trade: ${aiAnalysis.direction} with ${aiAnalysis.confidence}% confidence - ${aiAnalysis.reasoning}`);
              }
            } catch (aiError) {
              console.error(`[AutoTrade] AI analysis error, proceeding with caution:`, aiError);
              // Continue with trade if AI fails but minConfidence is 0
              if (minConfidence > 0) {
                console.log(`[AutoTrade] Skipping trade due to AI error and minConfidence requirement`);
                continue;
              }
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
          
          // DUPLICATE TRADE PREVENTION: Check if there's already an open auto-trade at similar price
          const openPositions = await storage.getDemoPositions(settings.userId, 'open');
          const existingAutoTrade = openPositions.find(pos => 
            pos.symbol === settings.symbol && 
            pos.isAutoTrade === true
          );
          
          if (existingAutoTrade) {
            // Calculate price tolerance (0.05% of current price, or use pip-based tolerance)
            const pipValue = getPipValue(settings.symbol);
            const priceTolerance = Math.max(currentPrice * 0.0005, pipValue * 2); // 0.05% or 2 pips minimum
            const priceDifference = Math.abs(existingAutoTrade.entryPrice - currentPrice);
            
            if (priceDifference <= priceTolerance) {
              console.log(`[AutoTrade] Skipping duplicate trade for ${settings.symbol}: Open position exists at $${existingAutoTrade.entryPrice.toFixed(2)} (current: $${currentPrice.toFixed(2)}, diff: $${priceDifference.toFixed(4)}, tolerance: $${priceTolerance.toFixed(4)})`);
              continue;
            }
            console.log(`[AutoTrade] Existing position at $${existingAutoTrade.entryPrice.toFixed(2)}, but price moved significantly to $${currentPrice.toFixed(2)} (diff: $${priceDifference.toFixed(4)} > tolerance: $${priceTolerance.toFixed(4)})`);
          }
          
          // Calculate stop loss and take profit
          // PRIORITY 1: Use precision trade plan from AI suggestion if available
          // PRIORITY 2: Fall back to user's configured SL/TP calculation mode
          const tradeType = suggestion.decision as 'BUY' | 'SELL';
          
          let stopLoss: number | undefined;
          let takeProfit: number | undefined;
          
          // Check if suggestion has precision trade plan SL/TP
          if (suggestion.stopLoss && suggestion.takeProfit2) {
            // Use precision SL/TP from trade plan (TP2 = 2R is the main target)
            stopLoss = suggestion.stopLoss;
            takeProfit = suggestion.takeProfit2; // Use TP2 as primary take profit target
            console.log(`[AutoTrade] Using precision trade plan: SL=$${stopLoss.toFixed(2)}, TP=$${takeProfit.toFixed(2)} (R:R ${suggestion.riskRewardRatio?.toFixed(1) || '?'}:1)`);
          } else {
            // Fall back to calculated SL/TP based on user settings
            const slTpMode = settings.slTpMode || 'atr';
            const stopLossValue = settings.stopLossValue || 1.5;
            const takeProfitValue = settings.takeProfitValue || 3;
            
            // Get ATR from technical signal if using ATR mode
            let atrValue: number | undefined;
            if (slTpMode === 'atr') {
              const atrCandles = await storage.getRecentMarketData(settings.symbol, 100);
              if (atrCandles.length >= 30) {
                const technicalSignal = generateUnifiedSignal(atrCandles);
                atrValue = technicalSignal.indicators.atr;
                console.log(`[AutoTrade] ATR for ${settings.symbol}: ${atrValue?.toFixed(4)}`);
              }
            }
            
            const calculated = calculateSlTpPrices(
              currentPrice,
              tradeType,
              slTpMode,
              stopLossValue,
              settings.symbol,
              takeProfitValue,
              atrValue
            );
            stopLoss = calculated.stopLoss;
            takeProfit = calculated.takeProfit;
            console.log(`[AutoTrade] Using calculated SL/TP (${slTpMode} mode): SL=$${stopLoss?.toFixed(2) || 'N/A'}, TP=$${takeProfit?.toFixed(2) || 'N/A'}`);
          }
          
          // Open the trade with isAutoTrade flag and SL/TP
          const result = await storage.openDemoTrade(
            settings.userId,
            settings.symbol,
            tradeType,
            currentPrice,
            quantity,
            stopLoss,
            takeProfit,
            true // isAutoTrade
          );
          
          if (result) {
            // Record the auto-trade
            await storage.recordAutoTrade(settings.userId, suggestion.decision);
            
            const slStr = stopLoss ? `SL: $${stopLoss.toFixed(2)}` : 'No SL';
            const tpStr = takeProfit ? `TP: $${takeProfit.toFixed(2)}` : 'No TP';
            console.log(`[AutoTrade] Executed ${tradeType} trade for user ${settings.userId}: ${quantity.toFixed(6)} ${settings.symbol} @ $${currentPrice.toFixed(2)} | ${slStr} | ${tpStr}`);
            
            // Broadcast auto-trade event via WebSocket
            wsService.broadcast({
              type: "auto_trade_executed",
              symbol: settings.symbol,
              timestamp: new Date().toISOString(),
              data: {
                userId: settings.userId,
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

  // Process precision auto-trades using exact Entry/SL/TP from AI suggestions
  private async processPrecisionTrades(): Promise<void> {
    try {
      // Get all settings with precision signals enabled
      const precisionSettings = await storage.getAllPrecisionEnabledAutoTradeSettings();
      
      if (precisionSettings.length === 0) {
        return;
      }
      
      console.log(`[PrecisionTrade] Processing ${precisionSettings.length} precision auto-trade settings`);
      
      for (const settings of precisionSettings) {
        try {
          // Get the latest actionable AI suggestion with precision trade plan
          const suggestion = await storage.getLatestActionableAiSuggestion(settings.symbol, 5);
          
          if (!suggestion) {
            continue;
          }
          
          // Must have entryPrice and stopLoss for precision trades
          if (!suggestion.entryPrice || !suggestion.stopLoss) {
            console.log(`[PrecisionTrade] ${settings.symbol}: No precision Entry/SL available in suggestion`);
            continue;
          }
          
          // Use takeProfit1 or takeProfit2 as TP
          const takeProfit = suggestion.takeProfit1 || suggestion.takeProfit2;
          if (!takeProfit) {
            console.log(`[PrecisionTrade] ${settings.symbol}: No precision Take Profit available`);
            continue;
          }
          
          // Check if we already traded on this suggestion
          if (settings.lastPrecisionTradeAt && suggestion.generatedAt) {
            const suggestionTime = new Date(suggestion.generatedAt).getTime();
            const lastTradeTime = new Date(settings.lastPrecisionTradeAt).getTime();
            
            if (lastTradeTime >= suggestionTime - 30000) {
              continue;
            }
          }
          
          // Get user's demo account
          const account = await storage.getDemoAccount(settings.userId);
          
          if (!account) {
            console.log(`[PrecisionTrade] No demo account for user ${settings.userId}`);
            continue;
          }
          
          const tradeUnits = settings.precisionTradeUnits || 0.01;
          const entryPrice = suggestion.entryPrice;
          const requiredUsd = tradeUnits * entryPrice;
          
          // Check balance
          if (account.balance < requiredUsd) {
            console.log(`[PrecisionTrade] Insufficient balance for user ${settings.userId}`);
            continue;
          }
          
          // Check for duplicate open positions
          const openPositions = await storage.getDemoPositions(settings.userId, 'open');
          const existingPrecisionTrade = openPositions.find(pos => 
            pos.symbol === settings.symbol && pos.isAutoTrade === true
          );
          
          if (existingPrecisionTrade) {
            const priceTolerance = entryPrice * 0.001; // 0.1%
            if (Math.abs(existingPrecisionTrade.entryPrice - entryPrice) <= priceTolerance) {
              continue;
            }
          }
          
          const tradeType = suggestion.decision as 'BUY' | 'SELL';
          
          console.log(`[PrecisionTrade] Executing ${tradeType} for ${settings.symbol}: Entry=$${entryPrice.toFixed(2)}, SL=$${suggestion.stopLoss.toFixed(2)}, TP=$${takeProfit.toFixed(2)}`);
          
          // Open the precision trade
          const result = await storage.openDemoTrade(
            settings.userId,
            settings.symbol,
            tradeType,
            entryPrice,
            tradeUnits,
            suggestion.stopLoss,
            takeProfit,
            true // isAutoTrade
          );
          
          if (result) {
            // Update lastPrecisionTradeAt
            await storage.updateAutoTradeSettings(settings.userId, {
              lastPrecisionTradeAt: new Date(),
            });
            
            // Record the auto-trade
            await storage.recordAutoTrade(settings.userId, suggestion.decision);
            
            console.log(`[PrecisionTrade] Executed ${tradeType} for user ${settings.userId}: ${tradeUnits} ${settings.symbol} @ $${entryPrice.toFixed(2)} | SL: $${suggestion.stopLoss.toFixed(2)} | TP: $${takeProfit.toFixed(2)}`);
            
            wsService.broadcast({
              type: "precision_trade_executed",
              symbol: settings.symbol,
              timestamp: new Date().toISOString(),
              data: {
                userId: settings.userId,
                symbol: settings.symbol,
                decision: suggestion.decision,
                quantity: tradeUnits,
                entryPrice,
                stopLoss: suggestion.stopLoss,
                takeProfit,
                riskRewardRatio: suggestion.riskRewardRatio,
              },
            });
          }
        } catch (userError) {
          console.error(`[PrecisionTrade] Error for user ${settings.userId}:`, userError);
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error in precision trade processing:", error);
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
          timestamp: new Date().toISOString(),
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
