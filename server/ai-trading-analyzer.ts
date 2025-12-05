import OpenAI from "openai";
import type { MarketData } from "@shared/schema";
import { generateUnifiedSignal, type UnifiedSignalResult } from "./unified-signal-generator";
import { storage } from "./storage";
import { decrypt } from "./encryption";

// Cache for OpenAI client to avoid recreating on every call
let cachedOpenAIClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

async function getOpenAIKey(): Promise<string | null> {
  // Environment variable takes precedence
  const envKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (envKey && envKey !== "not-configured") {
    return envKey;
  }
  
  // Check database for encrypted key
  try {
    const encryptedKey = await storage.getSetting("OPENAI_API_KEY_ENCRYPTED");
    if (encryptedKey) {
      return decrypt(encryptedKey);
    }
  } catch (e) {
    console.error("[AI Analyzer] Failed to retrieve OpenAI key from database:", e);
  }
  
  return null;
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
  cachedOpenAIClient = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: apiKey
  });
  
  return cachedOpenAIClient;
}

// Check for OpenAI API key on startup (async check happens on first use)
const envKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (!envKey || envKey === "not-configured") {
  console.log("[AI Analyzer] OpenAI API key not in environment - will check database on first use");
  console.log("[AI Analyzer] Configure via Settings page or set AI_INTEGRATIONS_OPENAI_API_KEY");
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

export interface MarketContext {
  symbol: string;
  currentPrice: number;
  priceChange1h: number;
  priceChange24h: number;
  volatility: number;
  trend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  technicalSignal: UnifiedSignalResult;
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

function buildMarketContext(symbol: string, candles: MarketData[], technicalSignal: UnifiedSignalResult): MarketContext {
  const currentPrice = candles[candles.length - 1]?.close || 0;
  const hourAgoPrice = candles.length >= 60 ? candles[candles.length - 60]?.close || currentPrice : currentPrice;
  const dayAgoPrice = candles.length >= 1440 ? candles[candles.length - 1440]?.close || currentPrice : candles[0]?.close || currentPrice;
  
  return {
    symbol,
    currentPrice,
    priceChange1h: ((currentPrice - hourAgoPrice) / hourAgoPrice) * 100,
    priceChange24h: ((currentPrice - dayAgoPrice) / dayAgoPrice) * 100,
    volatility: calculateVolatility(candles.slice(-60)),
    trend: determineTrend(candles),
    technicalSignal,
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

  const context = buildMarketContext(symbol, candles, technicalSignal);
  
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
      
      // Fallback to technical analysis only when no AI confidence requirement is set
      const fallbackConfidence = technicalSignal.confidence;
      const shouldTrade = technicalSignal.decision !== "HOLD" && fallbackConfidence >= 50;
      
      return {
        shouldTrade,
        direction: technicalSignal.decision,
        confidence: fallbackConfidence,
        reasoning: "Using technical analysis (no OpenAI API key configured)",
        riskLevel: fallbackConfidence >= 70 ? "LOW" : fallbackConfidence >= 50 ? "MEDIUM" : "HIGH",
        suggestedAction: shouldTrade ? `Execute ${technicalSignal.decision} based on technical signals` : "Hold - low confidence",
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
    
    // STRICTER AI FILTER: Multiple conditions must be met
    // 1. Confidence must meet minimum threshold
    // 2. Direction must not be HOLD
    // 3. Risk level must be LOW (not MEDIUM or HIGH)
    // 4. AI and technical signals must agree on direction
    // 5. Technical signal must also have sufficient confidence (>= 50%)
    // 6. Volatility must not be extreme (< 0.8%)
    const isLowRisk = riskLevel === "LOW";
    const signalsAgree = signalsAlign(direction, technicalSignal.decision);
    const technicallyStrong = technicalSignal.confidence >= 50;
    const lowVolatility = context.volatility < 0.8;
    
    const shouldTrade = confidence >= minConfidence && 
                        direction !== "HOLD" && 
                        isLowRisk &&
                        signalsAgree &&
                        technicallyStrong &&
                        lowVolatility;
    
    // Log decision details for transparency
    if (!shouldTrade && direction !== "HOLD") {
      const reasons: string[] = [];
      if (confidence < minConfidence) reasons.push(`confidence ${confidence} < ${minConfidence}`);
      if (!isLowRisk) reasons.push(`risk level is ${riskLevel}`);
      if (!signalsAgree) reasons.push(`AI (${direction}) != Technical (${technicalSignal.decision})`);
      if (!technicallyStrong) reasons.push(`tech confidence ${technicalSignal.confidence} < 50`);
      if (!lowVolatility) reasons.push(`volatility ${context.volatility.toFixed(3)} >= 0.8%`);
      console.log(`[AI Filter] Blocked trade for ${context.symbol}: ${reasons.join(", ")}`);
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
    
    // Fallback to technical analysis only when no AI confidence requirement is set
    const fallbackConfidence = technicalSignal.confidence;
    const shouldTrade = technicalSignal.decision !== "HOLD" && fallbackConfidence >= 50;
    
    return {
      shouldTrade,
      direction: technicalSignal.decision,
      confidence: fallbackConfidence,
      reasoning: "Using technical analysis (AI unavailable, no minConfidence set)",
      riskLevel: fallbackConfidence >= 70 ? "LOW" : fallbackConfidence >= 50 ? "MEDIUM" : "HIGH",
      suggestedAction: shouldTrade ? `Execute ${technicalSignal.decision} based on technical signals` : "Hold - low confidence",
      technicalSignal,
      aiEnhanced: false,
    };
  }
}

function buildAnalysisPrompt(context: MarketContext): string {
  const { symbol, currentPrice, priceChange1h, priceChange24h, volatility, trend, technicalSignal } = context;
  
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
  
  // Detect candlestick patterns from signal reasons
  const patternReason = technicalSignal.reasons.find(r => r.indicator === "Pattern");
  const patternStatus = patternReason?.signal === "bullish" ? "BULLISH" : (patternReason?.signal === "bearish" ? "BEARISH" : "NEUTRAL");
  const patternDescription = patternReason?.description || "No significant candlestick patterns detected";
  
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

Based on all the above data, provide your trading analysis in this exact JSON format:
{
  "direction": "BUY" or "SELL" or "HOLD",
  "confidence": 0-100 (be conservative - only high confidence when multiple indicators align),
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "reasoning": "Brief explanation referencing specific indicators that influenced your decision",
  "suggestedAction": "Specific action recommendation with entry/exit context"
}

DECISION RULES:
1. HOLD if indicators are mixed (similar bullish/bearish count) - wait for clarity
2. BUY only if: RSI not overbought, MACD positive or turning positive, price trend supports
3. SELL only if: RSI not oversold, MACD negative or turning negative, price trend supports
4. HIGH risk if: volatility > 0.5%, conflicting indicators, or extreme RSI with no confirmation
5. LOW risk only if: 3+ indicators agree, moderate volatility, clear trend direction
6. Consider if the move already happened - avoid chasing extended moves
7. Weight MACD and EMA crossover heavily as primary trend indicators`;
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
