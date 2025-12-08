import OpenAI from "openai";
import type { MarketData } from "@shared/schema";
import { generateUnifiedSignal, type UnifiedSignalResult } from "./unified-signal-generator";
import { storage } from "./storage";
import { decrypt } from "./encryption";

// Cache for OpenAI client to avoid recreating on every call
let cachedOpenAIClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

async function getOpenAIKey(): Promise<string | null> {
  // Priority 1: Check database for encrypted key (configured via Settings page)
  // This is the PRIMARY source - users configure their key through the UI
  try {
    const encryptedKey = await storage.getSetting("OPENAI_API_KEY_ENCRYPTED");
    if (encryptedKey) {
      const decryptedKey = decrypt(encryptedKey);
      if (decryptedKey) {
        return decryptedKey;
      }
    }
  } catch (e) {
    console.error("[AI Analyzer] Failed to retrieve OpenAI key from database:", e);
  }
  
  // Priority 2: Check for Replit's managed OpenAI integration (automatic on Replit)
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (replitKey && replitKey !== "not-configured") {
    return replitKey;
  }
  
  // Priority 3: Check for standard OPENAI_API_KEY environment variable (optional override)
  const standardKey = process.env.OPENAI_API_KEY;
  if (standardKey && standardKey !== "not-configured") {
    return standardKey;
  }
  
  return null;
}

function getOpenAIBaseURL(): string | undefined {
  // If using Replit's integration, use their base URL
  if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    return process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  }
  // For self-hosted or standard OpenAI key, use default OpenAI API
  return undefined; // OpenAI SDK will use https://api.openai.com/v1 by default
}

async function getOpenAIClient(): Promise<OpenAI | null> {
  const apiKey = await getOpenAIKey();
  
  if (!apiKey) {
    cachedOpenAIClient = null;
    cachedApiKey = null;
    return null;
  }
  
  // Return cached client if key hasn't changed
  if (cachedOpenAIClient && cachedApiKey === apiKey) {
    return cachedOpenAIClient;
  }
  
  // Create new client with updated key
  cachedApiKey = apiKey;
  const baseURL = getOpenAIBaseURL();
  cachedOpenAIClient = new OpenAI({
    baseURL: baseURL,
    apiKey: apiKey
  });
  
  console.log(`[AI Analyzer] OpenAI client initialized (using ${baseURL ? 'Replit proxy' : 'direct OpenAI API'})`);
  
  return cachedOpenAIClient;
}

// Log OpenAI key source on startup (actual key retrieval happens on first use)
const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (replitKey && replitKey !== "not-configured") {
  console.log("[AI Analyzer] Replit OpenAI integration detected (database key takes priority if configured)");
} else {
  console.log("[AI Analyzer] Will use OpenAI key from database (Settings page) - configure via Settings if needed");
}

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
    // Get OpenAI client dynamically (checks env first, then database)
    const openai = await getOpenAIClient();
    
    if (!openai) {
      console.log("[AI Analyzer] No OpenAI API key configured");
      
      // No API key available - check if AI filter is required
      if (minConfidence > 0) {
        console.log("[AI Analyzer] AI unavailable and minConfidence is set - blocking trade for safety");
        return {
          shouldTrade: false,
          direction: "HOLD",
          confidence: 0,
          reasoning: "AI analysis unavailable - no API key configured. Set key in Settings or environment.",
          riskLevel: "HIGH",
          suggestedAction: "Configure OpenAI API key in Settings to enable AI-enhanced trading",
          technicalSignal,
          aiEnhanced: false,
        };
      }
      
      // STRICT FALLBACK: When no OpenAI key configured, only allow very high-confidence trades
      const fallbackConfidence = technicalSignal.confidence;
      const veryHighConfidence = fallbackConfidence >= 80;
      const shouldTrade = veryHighConfidence && technicalSignal.decision !== "HOLD";
      
      console.log(`[AI Analyzer] No OpenAI key fallback - tech confidence: ${fallbackConfidence}, allowing trade: ${shouldTrade}`);
      
      return {
        shouldTrade,
        direction: shouldTrade ? technicalSignal.decision : "HOLD",
        confidence: shouldTrade ? fallbackConfidence : 0,
        reasoning: shouldTrade 
          ? `Using technical analysis only (very high confidence ${fallbackConfidence}%, no AI key)`
          : "No OpenAI API key - defaulting to HOLD for safety (tech confidence too low to trade without AI)",
        riskLevel: shouldTrade ? "MEDIUM" : "HIGH",
        suggestedAction: shouldTrade 
          ? `Execute ${technicalSignal.decision} based on strong technical signals`
          : "Configure OpenAI API key in Settings to enable AI-enhanced trading",
        technicalSignal,
        aiEnhanced: false,
      };
    }
    
    const prompt = buildAnalysisPrompt(context);
    
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",  // Cheapest option: $0.05/1M input, $0.40/1M output
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
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const aiAnalysis = JSON.parse(content);
    
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
    console.error("[AI Analyzer] Error calling OpenAI:", error);
    
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
        suggestedAction: "Wait for AI service to become available",
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
        : "Wait for AI service to become available",
      technicalSignal,
      aiEnhanced: false,
    };
  }
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
  
  return `Analyze this trading opportunity for ${symbol}:

CURRENT MARKET STATE:
- Current Price: $${currentPrice.toFixed(2)}
- 1-Hour Change: ${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(2)}%
- 24-Hour Change: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%
- Volatility (1h): ${volatility.toFixed(3)}%
- Overall Trend: ${trend}

RAW TECHNICAL INDICATOR VALUES:
- EMA 12/26: ${indicators.ema12.toFixed(2)} / ${indicators.ema26.toFixed(2)} (spread: ${emaSpread >= 0 ? '+' : ''}${emaSpread.toFixed(2)})
- RSI(14): ${indicators.rsi14.toFixed(1)}
- MACD: Line ${indicators.macdLine.toFixed(3)} | Signal ${indicators.macdSignal.toFixed(3)} | Histogram ${indicators.macdHistogram.toFixed(3)}
- Stochastic: %K ${indicators.stochK.toFixed(1)} | %D ${indicators.stochD.toFixed(1)}
- ATR(14): ${indicators.atr.toFixed(2)} (average price movement)

ANALYSIS BREAKDOWN (${bullishCount} Bullish, ${bearishCount} Bearish, ${neutralCount} Neutral):
${breakdownText}

TECHNICAL SIGNAL SUMMARY:
- Decision: ${technicalSignal.decision}
- Confidence: ${technicalSignal.confidence}%
- Bullish Score: ${technicalSignal.bullishScore} | Bearish Score: ${technicalSignal.bearishScore} | Net Score: ${technicalSignal.netScore}
- Buy Target: ${technicalSignal.targets.buyTarget ? '$' + technicalSignal.targets.buyTarget.toFixed(2) : 'N/A'}
- Sell Target: ${technicalSignal.targets.sellTarget ? '$' + technicalSignal.targets.sellTarget.toFixed(2) : 'N/A'}

PREDICTION MODEL DATA:
${prediction.latestPrediction ? `- Latest Prediction: $${prediction.latestPrediction.predictedPrice?.toFixed(2) || 'N/A'} (${prediction.latestPrediction.predictedDirection})
- Prediction Confidence: ${prediction.latestPrediction.confidence?.toFixed(1) || 'N/A'}%
- Price Delta: ${prediction.latestPrediction.predictedPrice ? (prediction.latestPrediction.predictedPrice > currentPrice ? '+' : '') + (prediction.latestPrediction.predictedPrice - currentPrice).toFixed(2) : 'N/A'}` : '- No recent prediction available'}
- Historical Accuracy: ${prediction.recentAccuracy.accuracyPercent.toFixed(1)}% (${prediction.recentAccuracy.matchCount}/${prediction.recentAccuracy.totalPredictions} predictions matched)
- Average Prediction Error: ${prediction.recentAccuracy.averageError.toFixed(3)}%

Based on all the above data (technical indicators + prediction model), provide your trading analysis in this exact JSON format:
{
  "direction": "BUY" or "SELL" or "HOLD",
  "confidence": 0-100 (be conservative - only high confidence when BOTH technical and prediction signals align),
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "reasoning": "Brief explanation referencing specific indicators AND prediction data that influenced your decision",
  "suggestedAction": "Specific action recommendation with entry/exit context"
}

DECISION RULES (Technical Analysis):
1. HOLD if indicators are mixed (similar bullish/bearish count) - wait for clarity
2. BUY only if: RSI not overbought, MACD positive or turning positive, price trend supports
3. SELL only if: RSI not oversold, MACD negative or turning negative, price trend supports
4. HIGH risk if: volatility > 0.5%, conflicting indicators, or extreme RSI with no confirmation
5. LOW risk only if: 3+ indicators agree, moderate volatility, clear trend direction
6. Consider if the move already happened - avoid chasing extended moves
7. Weight MACD and EMA crossover heavily as primary trend indicators

DECISION RULES (Prediction Model - CRITICAL):
8. CHECK PREDICTION ACCURACY FIRST: If historical accuracy is >90%, prediction is HIGHLY reliable - match your direction to it
9. If prediction accuracy is 70-90%, use prediction as a confirming factor (not primary driver)
10. If prediction accuracy is <70%, discount prediction data and rely on technicals alone
11. PREDICTION-TECHNICAL CONFLICT: If high-accuracy prediction (>90%) conflicts with technical signal, prefer HOLD
12. BOOST CONFIDENCE: When high-accuracy prediction aligns with technical signal, add 10-15% to confidence
13. Always mention prediction direction and accuracy in your reasoning when accuracy is >80%`;
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
