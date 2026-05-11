import type { MarketData } from "@shared/schema";
import { generateUnifiedSignal, type UnifiedSignalResult } from "./unified-signal-generator";
import { chatCompletion, isOllamaAvailable } from "./local-ai-client";
import { storage } from "./storage";

export interface AITradingAnalysis {
  shouldTrade: boolean;
  direction: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  suggestedAction: string;
  technicalSignal: UnifiedSignalResult;
  aiEnhanced: boolean;
}

export interface PredictionContext {
  latestPrediction: {
    predictedPrice: number | null;
    predictedDirection: string;
    confidence: number | null;
    timeframe: string;
  } | null;
  recentAccuracy: {
    totalPredictions: number;
    matchCount: number;
    accuracyPercent: number;
    averageError: number;
  };
}

export interface MarketContext {
  symbol: string;
  currentPrice: number;
  priceChange1h: number;
  priceChange24h: number;
  volatility: number;
  trend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  technicalSignal: UnifiedSignalResult;
  prediction: PredictionContext;
}

function calculateVolatility(candles: MarketData[]): number {
  if (candles.length < 10) return 0;
  const returns = [];
  for (let i = 1; i < candles.length; i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close * 100);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

function determineTrend(candles: MarketData[]): "UPTREND" | "DOWNTREND" | "SIDEWAYS" {
  if (candles.length < 20) return "SIDEWAYS";
  
  const recent = candles.slice(-20);
  const firstHalf = recent.slice(0, 10);
  const secondHalf = recent.slice(10);
  
  const firstAvg = firstHalf.reduce((a, b) => a + b.close, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b.close, 0) / secondHalf.length;
  
  const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;
  
  if (changePercent > 0.3) return "UPTREND";
  if (changePercent < -0.3) return "DOWNTREND";
  return "SIDEWAYS";
}

async function buildMarketContext(symbol: string, candles: MarketData[], technicalSignal: UnifiedSignalResult): Promise<MarketContext> {
  const currentPrice = candles[candles.length - 1]?.close || 0;
  const hourAgoPrice = candles.length >= 60 ? candles[candles.length - 60]?.close || currentPrice : currentPrice;
  const dayAgoPrice = candles.length >= 1440 ? candles[candles.length - 1440]?.close || currentPrice : candles[0]?.close || currentPrice;
  
  // Fetch prediction data from storage
  let predictionContext: PredictionContext = {
    latestPrediction: null,
    recentAccuracy: {
      totalPredictions: 0,
      matchCount: 0,
      accuracyPercent: 0,
      averageError: 0,
    }
  };
  
  try {
    // Get latest predictions for this symbol
    const recentPredictions = await storage.getRecentPredictions(symbol, 10, "1min");
    if (recentPredictions.length > 0) {
      const latest = recentPredictions[0];
      predictionContext.latestPrediction = {
        predictedPrice: latest.predictedPrice,
        predictedDirection: latest.predictedDirection,
        confidence: latest.confidence,
        timeframe: latest.timeframe,
      };
    }
    
    // Get accuracy stats
    const accuracyStats = await storage.getAccuracyStats(symbol);
    predictionContext.recentAccuracy = {
      totalPredictions: accuracyStats.totalPredictions,
      matchCount: accuracyStats.matchCount,
      accuracyPercent: accuracyStats.accuracyPercent,
      averageError: accuracyStats.averageError,
    };
  } catch (e) {
    console.error("[AI Analyzer] Failed to fetch prediction data:", e);
  }
  
  return {
    symbol,
    currentPrice,
    priceChange1h: ((currentPrice - hourAgoPrice) / hourAgoPrice) * 100,
    priceChange24h: ((currentPrice - dayAgoPrice) / dayAgoPrice) * 100,
    volatility: calculateVolatility(candles.slice(-60)),
    trend: determineTrend(candles),
    technicalSignal,
    prediction: predictionContext,
  };
}

export async function analyzeWithAI(
  symbol: string,
  candles: MarketData[],
  minConfidence: number = 60
): Promise<AITradingAnalysis> {
  const technicalSignal = generateUnifiedSignal(candles);
  
  if (candles.length < 30) {
    return {
      shouldTrade: false,
      direction: "HOLD",
      confidence: 0,
      reasoning: "Insufficient market data for analysis",
      riskLevel: "HIGH",
      suggestedAction: "Wait for more data before trading",
      technicalSignal,
      aiEnhanced: false,
    };
  }

  const context = await buildMarketContext(symbol, candles, technicalSignal);

  try {
    // Check if Ollama is available
    const ollamaAvailable = await isOllamaAvailable();

    if (!ollamaAvailable) {
      console.log("[AI Analyzer] Ollama service not available");

      // Ollama unavailable - check if AI filter is required
      if (minConfidence > 0) {
        console.log("[AI Analyzer] AI unavailable and minConfidence is set - blocking trade for safety");
        return {
          shouldTrade: false,
          direction: "HOLD",
          confidence: 0,
          reasoning: "AI analysis unavailable - Ollama service not running. Start Ollama to enable AI-enhanced trading.",
          riskLevel: "HIGH",
          suggestedAction: "Start Ollama service to enable AI-enhanced trading",
          technicalSignal,
          aiEnhanced: false,
        };
      }

      // STRICT FALLBACK: When Ollama unavailable, only allow very high-confidence trades
      const fallbackConfidence = technicalSignal.confidence;
      const veryHighConfidence = fallbackConfidence >= 80;
      const shouldTrade = veryHighConfidence && technicalSignal.decision !== "HOLD";

      console.log(`[AI Analyzer] Ollama unavailable fallback - tech confidence: ${fallbackConfidence}, allowing trade: ${shouldTrade}`);

      return {
        shouldTrade,
        direction: shouldTrade ? technicalSignal.decision : "HOLD",
        confidence: shouldTrade ? fallbackConfidence : 0,
        reasoning: shouldTrade
          ? `Using technical analysis only (very high confidence ${fallbackConfidence}%, Ollama unavailable)`
          : "Ollama service unavailable - defaulting to HOLD for safety (tech confidence too low to trade without AI)",
        riskLevel: shouldTrade ? "MEDIUM" : "HIGH",
        suggestedAction: shouldTrade
          ? `Execute ${technicalSignal.decision} based on strong technical signals`
          : "Start Ollama service to enable AI-enhanced trading",
        technicalSignal,
        aiEnhanced: false,
      };
    }

    const prompt = buildAnalysisPrompt(context);

    const response = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `You are an expert financial market analyst specializing in short-term trading decisions.
Analyze market data and provide precise, actionable trading recommendations.
Your goal is to maximize win rate by only recommending trades with high probability of success.
Be conservative - it's better to miss a trade than lose money.
Always respond in valid JSON format.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      jsonMode: true,
      maxTokens: 1024,
    });

    const aiAnalysis = JSON.parse(response.content);
    
    const confidence = Math.min(Math.max(aiAnalysis.confidence || 0, 0), 100);
    const direction = validateDirection(aiAnalysis.direction);
    const riskLevel = validateRiskLevel(aiAnalysis.riskLevel);
    
    // AI FILTER CONDITIONS (adaptive based on asset type)
    // 1. Confidence must meet minimum threshold
    // 2. Direction must not be HOLD
    // 3. Risk level must be LOW (MEDIUM allowed if confidence >= 80%)
    // 4. AI and technical signals must agree on direction
    // 5. Technical signal must also have sufficient confidence (>= 40% for crypto, >= 50% for forex)
    // 6. Volatility must be acceptable (< 1.5% for crypto, < 0.8% for forex/metals)
    
    const isCrypto = context.symbol === "BTCUSD";
    
    // Adaptive thresholds for different asset classes
    const volatilityThreshold = isCrypto ? 1.5 : 0.8;  // Crypto is naturally more volatile
    const techConfidenceThreshold = isCrypto ? 40 : 50; // Lower tech threshold for volatile crypto
    
    const isLowRisk = riskLevel === "LOW" || (riskLevel === "MEDIUM" && confidence >= 80);
    const signalsAgree = signalsAlign(direction, technicalSignal.decision);
    const technicallyStrong = technicalSignal.confidence >= techConfidenceThreshold;
    const lowVolatility = context.volatility < volatilityThreshold;
    
    const shouldTrade = confidence >= minConfidence && 
                        direction !== "HOLD" && 
                        isLowRisk &&
                        signalsAgree &&
                        technicallyStrong &&
                        lowVolatility;
    
    // Always log decision details for transparency
    const riskRequirement = confidence >= 80 ? "LOW or MEDIUM" : "LOW only";
    const conditionStatus = {
      confidence: `${confidence}% (min: ${minConfidence}%) ${confidence >= minConfidence ? '✓' : '✗'}`,
      direction: `${direction} ${direction !== "HOLD" ? '✓' : '✗ (HOLD)'}`,
      riskLevel: `${riskLevel} ${isLowRisk ? '✓' : `✗ (need ${riskRequirement})`}`,
      signalAlign: `AI=${direction} vs Tech=${technicalSignal.decision} ${signalsAgree ? '✓' : '✗'}`,
      techConfidence: `${technicalSignal.confidence}% ${technicallyStrong ? '✓' : `✗ (need ≥${techConfidenceThreshold}%)`}`,
      volatility: `${(context.volatility * 100).toFixed(2)}% ${lowVolatility ? '✓' : `✗ (need <${volatilityThreshold}%)`}`,
    };
    
    const assetType = isCrypto ? "[CRYPTO]" : "[FOREX]";
    
    if (shouldTrade) {
      console.log(`[AI Filter] ${assetType} ✓ APPROVED trade for ${context.symbol}: ${direction} at ${confidence}% confidence`);
      console.log(`  Conditions: ${JSON.stringify(conditionStatus)}`);
    } else if (direction !== "HOLD") {
      const failedConditions: string[] = [];
      if (confidence < minConfidence) failedConditions.push(`confidence ${confidence}% < ${minConfidence}%`);
      if (!isLowRisk) failedConditions.push(`risk=${riskLevel} (need ${riskRequirement})`);
      if (!signalsAgree) failedConditions.push(`signals mismatch: AI=${direction} vs Tech=${technicalSignal.decision}`);
      if (!technicallyStrong) failedConditions.push(`tech confidence ${technicalSignal.confidence}% < ${techConfidenceThreshold}%`);
      if (!lowVolatility) failedConditions.push(`volatility ${(context.volatility * 100).toFixed(2)}% >= ${volatilityThreshold}%`);
      console.log(`[AI Filter] ${assetType} ✗ BLOCKED ${direction} trade for ${context.symbol}: ${failedConditions.join(", ")}`);
    } else {
      console.log(`[AI Filter] ${assetType} → HOLD decision for ${context.symbol} (no trade signal from AI)`);
    }
    
    return {
      shouldTrade,
      direction,
      confidence,
      reasoning: aiAnalysis.reasoning || "AI analysis completed",
      riskLevel,
      suggestedAction: aiAnalysis.suggestedAction || (shouldTrade ? `Execute ${direction} order` : "Wait for better opportunity"),
      technicalSignal,
      aiEnhanced: true,
    };
    
  } catch (error) {
    console.error("[AI Analyzer] Error calling Ollama local AI:", error);

    // CRITICAL: When AI is unavailable and user has configured AI filter,
    // we must NOT trade to respect their minimum confidence requirement.
    // Only allow fallback to technical analysis if minConfidence is 0 (disabled).
    if (minConfidence > 0) {
      console.log("[AI Analyzer] AI unavailable and minConfidence is set - blocking trade for safety");
      return {
        shouldTrade: false,
        direction: "HOLD",
        confidence: 0,
        reasoning: "AI analysis unavailable - trade blocked for safety (minConfidence requirement active)",
        riskLevel: "HIGH",
        suggestedAction: "Check that Ollama service is running",
        technicalSignal,
        aiEnhanced: false,
      };
    }

    // STRICT FALLBACK: When AI is unavailable, default to NO TRADE for safety.
    // Only allow very high-confidence technical signals (>=80) to proceed without AI validation.
    const fallbackConfidence = technicalSignal.confidence;
    const veryHighConfidence = fallbackConfidence >= 80;
    const shouldTrade = veryHighConfidence && technicalSignal.decision !== "HOLD";

    console.log(`[AI Analyzer] AI unavailable fallback - tech confidence: ${fallbackConfidence}, allowing trade: ${shouldTrade}`);

    return {
      shouldTrade,
      direction: shouldTrade ? technicalSignal.decision : "HOLD",
      confidence: shouldTrade ? fallbackConfidence : 0,
      reasoning: shouldTrade
        ? `Using technical analysis only (very high confidence ${fallbackConfidence}%)`
        : "AI unavailable - defaulting to HOLD for safety (tech confidence too low to trade without AI validation)",
      riskLevel: shouldTrade ? "MEDIUM" : "HIGH",
      suggestedAction: shouldTrade
        ? `Execute ${technicalSignal.decision} based on strong technical signals`
        : "Check that Ollama service is running",
      technicalSignal,
      aiEnhanced: false,
    };
  }
}

function getMarketSentimentContext(symbol: string, trend: string, priceChange24h: number, volatility: number): string {
  let sentiment = "NEUTRAL";
  let sentimentReason = "";
  
  // Determine market sentiment based on multiple factors
  if (trend === "UPTREND" && priceChange24h > 0.5) {
    sentiment = "BULLISH";
    sentimentReason = "Sustained upward momentum with positive 24h returns";
  } else if (trend === "DOWNTREND" && priceChange24h < -0.5) {
    sentiment = "BEARISH";
    sentimentReason = "Sustained downward pressure with negative 24h returns";
  } else if (volatility > 0.8) {
    sentiment = "CAUTIOUS";
    sentimentReason = "High volatility suggests uncertainty and potential whipsaws";
  }
  
  // Asset-specific context
  let assetContext = "";
  switch (symbol) {
    case "XAUUSD":
      assetContext = "Gold typically rises during market uncertainty, Fed rate cut expectations, or geopolitical tension. Falls when USD strengthens or risk appetite increases.";
      break;
    case "XAGUSD":
      assetContext = "Silver follows gold but with higher volatility. Also sensitive to industrial demand expectations.";
      break;
    case "BTCUSD":
      assetContext = "Bitcoin is highly volatile, trades 24/7, and is sensitive to regulatory news, institutional adoption, and broader crypto market sentiment.";
      break;
    case "SPX":
      assetContext = "S&P 500 reflects US equity market health. Sensitive to earnings, Fed policy, and economic data.";
      break;
    case "DXY":
      assetContext = "Dollar index inversely correlates with gold/commodities. Strengthens on Fed hawkishness or safe-haven flows.";
      break;
    case "USOIL":
      assetContext = "Crude oil sensitive to OPEC decisions, inventory data, geopolitical events, and global demand outlook.";
      break;
    default:
      assetContext = "Monitor relevant sector news and market-wide risk sentiment.";
  }
  
  return `
MARKET SENTIMENT ANALYSIS:
- Overall Sentiment: ${sentiment}
- Reason: ${sentimentReason || "Mixed signals, no clear directional bias"}
- Asset Context: ${assetContext}
- Volatility Regime: ${volatility > 0.8 ? "HIGH (reduce position size)" : volatility > 0.4 ? "MODERATE" : "LOW (favorable for entries)"}`;
}

function getRiskManagementContext(prediction: PredictionContext): string {
  const accuracy = prediction.recentAccuracy.accuracyPercent;
  let modelReliability = "UNTESTED";
  let riskAdvice = "Use maximum caution - no track record";
  
  if (prediction.recentAccuracy.totalPredictions >= 10) {
    if (accuracy >= 65) {
      modelReliability = "RELIABLE";
      riskAdvice = "Model has proven edge - can trade with confidence";
    } else if (accuracy >= 50) {
      modelReliability = "MARGINAL";
      riskAdvice = "Model is near breakeven - only trade strongest setups";
    } else {
      modelReliability = "POOR";
      riskAdvice = "Model underperforming - consider fading or avoiding";
    }
  }
  
  return `
RISK MANAGEMENT CONTEXT:
- Model Reliability: ${modelReliability} (${accuracy.toFixed(1)}% accuracy over ${prediction.recentAccuracy.totalPredictions} predictions)
- Risk Advice: ${riskAdvice}
- Average Error: ${prediction.recentAccuracy.averageError.toFixed(3)}%
- CRITICAL: Only recommend trades with clear edge and acceptable risk/reward`;
}

function buildAnalysisPrompt(context: MarketContext): string {
  const { symbol, currentPrice, priceChange1h, priceChange24h, volatility, trend, technicalSignal, prediction } = context;
  
  const indicators = technicalSignal.indicators;
  
  // Build comprehensive Analysis Breakdown matching UI display
  const emaSpread = indicators.ema12 - indicators.ema26;
  const emaSpreadPct = (emaSpread / indicators.ema26) * 100;
  const emaCrossStatus = Math.abs(emaSpreadPct) < 0.1 ? "NEUTRAL" : (emaSpreadPct > 0.1 ? "BULLISH" : "BEARISH");
  const emaDescription = Math.abs(emaSpreadPct) < 0.1 
    ? "EMA12 and EMA26 are converging" 
    : (emaSpreadPct > 0.1 ? "EMA12 crossed above EMA26 (bullish)" : "EMA12 crossed below EMA26 (bearish)");
  
  const rsiStatus = indicators.rsi14 < 30 ? "BULLISH" : (indicators.rsi14 > 70 ? "BEARISH" : "NEUTRAL");
  const rsiDescription = indicators.rsi14 < 30 
    ? `RSI (${indicators.rsi14.toFixed(1)}) oversold - potential reversal up`
    : (indicators.rsi14 > 70 
        ? `RSI (${indicators.rsi14.toFixed(1)}) overbought - potential reversal down`
        : `RSI (${indicators.rsi14.toFixed(1)}) in neutral zone`);
  
  const macdStatus = indicators.macdHistogram > 0.05 ? "BULLISH" : (indicators.macdHistogram < -0.05 ? "BEARISH" : "NEUTRAL");
  const macdDescription = indicators.macdHistogram > 0.05
    ? `MACD histogram positive (${indicators.macdHistogram.toFixed(3)}), momentum bullish`
    : (indicators.macdHistogram < -0.05
        ? `MACD histogram negative (${indicators.macdHistogram.toFixed(3)}), momentum bearish`
        : `MACD histogram near zero (${indicators.macdHistogram.toFixed(3)}), no clear momentum`);
  
  const stochStatus = indicators.stochK < 20 ? "BULLISH" : (indicators.stochK > 80 ? "BEARISH" : "NEUTRAL");
  const stochDescription = indicators.stochK < 20
    ? `Stochastic %K (${indicators.stochK.toFixed(1)}) oversold zone`
    : (indicators.stochK > 80
        ? `Stochastic %K (${indicators.stochK.toFixed(1)}) overbought zone`
        : `Stochastic %K (${indicators.stochK.toFixed(1)}) in neutral range`);
  
  const priceChangeStatus = priceChange1h > 0.5 ? "BULLISH" : (priceChange1h < -0.5 ? "BEARISH" : "NEUTRAL");
  const priceDescription = Math.abs(priceChange1h) < 0.1
    ? `Price relatively stable (${priceChange1h.toFixed(2)}%)`
    : `Price ${priceChange1h > 0 ? 'up' : 'down'} ${Math.abs(priceChange1h).toFixed(2)}% in last hour`;
  
  // Detect candlestick patterns from signal reasons (only from last 1-5 minute candles)
  const patternReasons = technicalSignal.reasons.filter(r => r.indicator === "Candlestick Patterns" && r.signal !== "neutral");
  const latestPattern = patternReasons.length > 0 ? patternReasons[patternReasons.length - 1] : null;
  const patternStatus = latestPattern?.signal === "bullish" ? "BULLISH" : (latestPattern?.signal === "bearish" ? "BEARISH" : "NEUTRAL");
  const patternDescription = latestPattern?.description || "No significant candlestick patterns in last 5 minutes";
  
  // Count bullish vs bearish signals for AI context
  const analysisBreakdown = [
    { name: "EMA Crossover", status: emaCrossStatus, description: emaDescription },
    { name: "RSI", status: rsiStatus, description: rsiDescription },
    { name: "MACD", status: macdStatus, description: macdDescription },
    { name: "Stochastic", status: stochStatus, description: stochDescription },
    { name: "Price Trend", status: priceChangeStatus, description: priceDescription },
    { name: "Candlestick Patterns", status: patternStatus, description: patternDescription },
  ];
  
  const bullishCount = analysisBreakdown.filter(a => a.status === "BULLISH").length;
  const bearishCount = analysisBreakdown.filter(a => a.status === "BEARISH").length;
  const neutralCount = analysisBreakdown.filter(a => a.status === "NEUTRAL").length;
  
  const breakdownText = analysisBreakdown.map(a => `  [${a.status}] ${a.name}: ${a.description}`).join("\n");
  
  const predictionInfo = prediction.latestPrediction
    ? `Pred: ${prediction.latestPrediction.predictedDirection} (acc:${prediction.recentAccuracy.accuracyPercent.toFixed(0)}%)`
    : "No prediction";

  return `${symbol} $${currentPrice.toFixed(2)} | 1h:${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(2)}% | 24h:${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}% | Vol:${volatility.toFixed(3)}% | Trend:${trend}
Indicators: RSI:${indicators.rsi14.toFixed(1)} MACD:${indicators.macdHistogram.toFixed(3)} Stoch:%K${indicators.stochK.toFixed(0)} EMA12/26:${emaSpreadPct.toFixed(2)}%
Signals: ${bullishCount}Bull ${bearishCount}Bear ${neutralCount}Neutral | Tech:${technicalSignal.decision}(${technicalSignal.confidence}%) | ${predictionInfo}

Output JSON: {"direction":"BUY|SELL|HOLD","confidence":0-100,"riskLevel":"LOW|MEDIUM|HIGH","reasoning":"brief","suggestedAction":"brief","marketCondition":"TRENDING|RANGING|VOLATILE","entryQuality":"EXCELLENT|GOOD|FAIR|POOR"}
Rules: HOLD if <4 indicators align, vol>0.8%, RSI>75(no BUY), RSI<25(no SELL). Max confidence 85. Conservative.`;
}

function validateDirection(direction: string): "BUY" | "SELL" | "HOLD" {
  const upper = (direction || "").toUpperCase();
  if (upper === "BUY") return "BUY";
  if (upper === "SELL") return "SELL";
  return "HOLD";
}

function validateRiskLevel(level: string): "LOW" | "MEDIUM" | "HIGH" {
  const upper = (level || "").toUpperCase();
  if (upper === "LOW") return "LOW";
  if (upper === "MEDIUM") return "MEDIUM";
  return "HIGH";
}

function signalsAlign(aiDirection: "BUY" | "SELL" | "HOLD", technicalDirection: "BUY" | "SELL" | "HOLD"): boolean {
  if (aiDirection === "HOLD" || technicalDirection === "HOLD") return true;
  return aiDirection === technicalDirection;
}

export async function getQuickSignal(symbol: string, candles: MarketData[]): Promise<{
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  aiEnhanced: boolean;
}> {
  try {
    const analysis = await analyzeWithAI(symbol, candles, 50);
    return {
      signal: analysis.shouldTrade ? analysis.direction : "HOLD",
      confidence: analysis.confidence,
      aiEnhanced: analysis.aiEnhanced,
    };
  } catch {
    const technicalSignal = generateUnifiedSignal(candles);
    return {
      signal: technicalSignal.decision,
      confidence: technicalSignal.confidence,
      aiEnhanced: false,
    };
  }
}
