import Parser from "rss-parser";
import OpenAI from "openai";
import crypto from "crypto";
import { storage } from "./storage";
import { decrypt } from "./encryption";
import type { InsertNewsArticle, NewsArticle, InsertNewsAnalysisSnapshot, NewsAnalysisSnapshot } from "@shared/schema";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  content: string;
  source: string;
}

export interface NewsAnalysis {
  fetchedAt: string;
  newsCount: number;
  news: NewsItem[];
  marketPrediction: {
    overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: number;
    summary: string;
    keyFactors: string[];
    affectedSymbols: {
      symbol: string;
      impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
      reason: string;
    }[];
    tradingRecommendation: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
  } | null;
  error?: string;
}

const DEFAULT_RSS_URL = "https://finance.yahoo.com/news/rssindex";

async function getOpenAIClient(): Promise<OpenAI | null> {
  // Priority 1: Direct OPENAI_API_KEY environment variable (best for production deployment)
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey && envKey !== "not-configured") {
    console.log("[NewsService] Using OPENAI_API_KEY environment variable (production mode)");
    return new OpenAI({ apiKey: envKey });
  }

  // Priority 2: Database stored encrypted key (Settings page) - uses standard OpenAI API
  try {
    const encryptedKey = await storage.getSetting("OPENAI_API_KEY_ENCRYPTED");
    if (encryptedKey) {
      const decryptedKey = decrypt(encryptedKey);
      console.log("[NewsService] Using database OpenAI key (user's own key from Settings)");
      return new OpenAI({
        apiKey: decryptedKey,
        // Do NOT use Replit base URL for user's own key - use standard OpenAI API
      });
    }
  } catch (e) {
    console.error("[NewsService] Failed to decrypt OpenAI key from database:", e);
  }

  // Priority 3: Replit's managed OpenAI integration (development fallback only)
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (replitKey && replitKey !== "not-configured") {
    console.log("[NewsService] Using Replit OpenAI integration (development fallback)");
    return new OpenAI({
      apiKey: replitKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  console.log("[NewsService] No OpenAI key configured - set OPENAI_API_KEY env var or configure in Settings");
  return null;
}

export async function getRssFeedUrl(): Promise<string> {
  const savedUrl = await storage.getSetting("RSS_FEED_URL");
  return savedUrl || DEFAULT_RSS_URL;
}

export async function setRssFeedUrl(url: string): Promise<void> {
  await storage.setSetting("RSS_FEED_URL", url);
}

// Parse HTML page and extract article-like content when RSS fails
async function fetchAsHtmlPage(pageUrl: string, feedName: string, maxItems: number): Promise<NewsItem[]> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TradeViewMon/1.0; +https://tradeviewmon.replit.app)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    
    if (!response.ok) {
      console.error(`[NewsService] HTTP ${response.status} for ${feedName}`);
      return [];
    }
    
    const html = await response.text();
    const items: NewsItem[] = [];
    
    // Extract headlines from common patterns: <h1>, <h2>, <h3>, <article>, etc.
    // Pattern 1: Look for article titles with links
    const articlePatterns = [
      // <a href="..."><h2>Title</h2></a> or <h2><a href="...">Title</a></h2>
      /<a[^>]+href=["']([^"']+)["'][^>]*>(?:<[^>]*>)*([^<]{10,200})(?:<[^>]*>)*<\/a>/gi,
      // <article...><h2>Title</h2>...</article>
      /<article[^>]*>[\s\S]*?<h[1-3][^>]*>([^<]{10,200})<\/h[1-3]>/gi,
      // Headlines with class containing "title" or "headline"
      /<[^>]+class=["'][^"']*(?:title|headline|heading)[^"']*["'][^>]*>([^<]{10,200})<\/[^>]+>/gi,
    ];
    
    const seenTitles = new Set<string>();
    
    for (const pattern of articlePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null && items.length < maxItems) {
        const title = (match[2] || match[1] || "").trim()
          .replace(/<[^>]+>/g, "") // Remove any remaining HTML tags
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ");
        
        // Skip if too short, already seen, or looks like navigation
        if (title.length < 15 || seenTitles.has(title.toLowerCase())) continue;
        if (/^(menu|home|about|contact|login|sign|search|nav|skip)/i.test(title)) continue;
        
        seenTitles.add(title.toLowerCase());
        
        const link = match[1]?.startsWith("http") ? match[1] : 
                     match[1]?.startsWith("/") ? new URL(match[1], pageUrl).href : pageUrl;
        
        items.push({
          title,
          link,
          pubDate: new Date().toISOString(), // Use current time since we can't extract date from HTML
          content: title, // Use title as content since we can't reliably extract article body
          source: feedName,
        });
      }
    }
    
    // Fallback: Extract any substantial text as a single news item
    if (items.length === 0) {
      // Try to get page title
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : feedName;
      
      // Extract meta description if available
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      const description = descMatch ? descMatch[1].trim() : "";
      
      if (pageTitle.length > 10 && description.length > 20) {
        items.push({
          title: pageTitle,
          link: pageUrl,
          pubDate: new Date().toISOString(),
          content: description,
          source: feedName,
        });
      }
    }
    
    console.log(`[NewsService] Extracted ${items.length} items from HTML page ${feedName}`);
    return items;
  } catch (error: any) {
    console.error(`[NewsService] Failed to parse HTML from ${feedName}:`, error.message);
    return [];
  }
}

async function fetchFromSingleFeed(feedUrl: string, feedName: string, maxItems: number): Promise<NewsItem[]> {
  try {
    // First, try RSS parsing
    const feed = await parser.parseURL(feedUrl);
    
    if (feed.items && feed.items.length > 0) {
      console.log(`[NewsService] RSS feed ${feedName}: ${feed.items.length} items`);
      return feed.items.slice(0, maxItems).map((item) => ({
        title: item.title || "Untitled",
        link: item.link || "",
        pubDate: item.pubDate || new Date().toISOString(),
        content: item.contentSnippet || item.content || "",
        source: feedName || feed.title || "News",
      }));
    }
    
    // RSS parsed but no items, try HTML fallback
    console.log(`[NewsService] RSS feed ${feedName} empty, trying HTML fallback`);
    return fetchAsHtmlPage(feedUrl, feedName, maxItems);
  } catch (error: any) {
    // RSS parsing failed, try HTML fallback
    console.log(`[NewsService] RSS parsing failed for ${feedName}, trying HTML fallback: ${error.message}`);
    return fetchAsHtmlPage(feedUrl, feedName, maxItems);
  }
}

export async function fetchNews(maxItems: number = 10): Promise<NewsItem[]> {
  // Get all active RSS feeds from database
  const feeds = await storage.getRssFeeds();
  const activeFeeds = feeds.filter(f => f.isActive);
  
  // If no feeds configured, fall back to legacy single feed setting or default
  if (activeFeeds.length === 0) {
    const feedUrl = await getRssFeedUrl();
    return fetchFromSingleFeed(feedUrl, "Yahoo Finance", maxItems);
  }
  
  // Fetch from all active feeds in parallel
  const feedPromises = activeFeeds.map(feed => 
    fetchFromSingleFeed(feed.url, feed.name, Math.ceil(maxItems / activeFeeds.length))
  );
  
  const results = await Promise.all(feedPromises);
  const allNews = results.flat();
  
  // Sort by date (newest first) and limit to maxItems
  allNews.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  
  return allNews.slice(0, maxItems);
}

export async function analyzeNewsWithAI(news: NewsItem[]): Promise<NewsAnalysis["marketPrediction"]> {
  const openai = await getOpenAIClient();
  
  if (!openai) {
    // Intentionally return null to show "Configure OpenAI" message in UI
    console.log("[NewsService] OpenAI not configured, skipping AI analysis");
    return null;
  }

  if (news.length === 0) {
    // No news to analyze - return default rather than null
    return getDefaultPrediction();
  }

  const newsContext = news
    .map((item, i) => `${i + 1}. [${item.pubDate}] ${item.title}\n   ${item.content.slice(0, 200)}...`)
    .join("\n\n");

  // Get supported symbols from database instead of hardcoding
  const monitoredSymbols = await storage.getMonitoredSymbols();
  const supportedSymbols = monitoredSymbols
    .filter(s => s.isActive)
    .map(s => s.symbol);
  
  // Fallback if no symbols configured
  if (supportedSymbols.length === 0) {
    console.log("[NewsService] No symbols in database, using defaults");
    supportedSymbols.push("XAUUSD", "XAGUSD", "BTCUSD");
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional financial analyst specializing in market analysis. 
Analyze the provided news headlines and content to generate market predictions.
Focus on how these news items might affect the following trading instruments: ${supportedSymbols.join(", ")}.

Respond in JSON format with this exact structure:
{
  "overallSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 0-100,
  "summary": "Brief 2-3 sentence market outlook based on the news",
  "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
  "affectedSymbols": [
    {"symbol": "XAUUSD", "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL", "reason": "Brief reason"}
  ],
  "tradingRecommendation": "Brief actionable recommendation",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}`,
        },
        {
          role: "user",
          content: `Analyze these recent financial news items and provide market predictions:\n\n${newsContext}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[NewsService] No JSON found in OpenAI response, using defaults");
      return getDefaultPrediction();
    }

    let prediction;
    try {
      prediction = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.warn("[NewsService] Failed to parse JSON from OpenAI, using defaults:", parseError);
      return getDefaultPrediction();
    }
    
    // Validate and sanitize response with safe defaults
    const validSentiments = ["BULLISH", "BEARISH", "NEUTRAL"];
    const validRiskLevels = ["LOW", "MEDIUM", "HIGH"];
    const validImpacts = ["POSITIVE", "NEGATIVE", "NEUTRAL"];
    
    const sentiment = validSentiments.includes(prediction.overallSentiment) 
      ? prediction.overallSentiment 
      : "NEUTRAL";
    
    const riskLevel = validRiskLevels.includes(prediction.riskLevel) 
      ? prediction.riskLevel 
      : "MEDIUM";
    
    // Validate affected symbols
    const affectedSymbols = Array.isArray(prediction.affectedSymbols)
      ? prediction.affectedSymbols
          .filter((s: any) => s && typeof s.symbol === "string")
          .map((s: any) => ({
            symbol: String(s.symbol),
            impact: validImpacts.includes(s.impact) ? s.impact : "NEUTRAL",
            reason: typeof s.reason === "string" ? s.reason : "",
          }))
      : [];
    
    return {
      overallSentiment: sentiment,
      confidence: Math.min(100, Math.max(0, Number(prediction.confidence) || 50)),
      summary: typeof prediction.summary === "string" ? prediction.summary : "Market conditions remain mixed",
      keyFactors: Array.isArray(prediction.keyFactors) 
        ? prediction.keyFactors.filter((f: any) => typeof f === "string").slice(0, 10) 
        : [],
      affectedSymbols,
      tradingRecommendation: typeof prediction.tradingRecommendation === "string" 
        ? prediction.tradingRecommendation 
        : "Monitor market conditions before trading",
      riskLevel,
    };
  } catch (error) {
    console.error("[NewsService] AI analysis failed:", error);
    // Return default prediction for graceful degradation
    return getDefaultPrediction();
  }
}

function getDefaultPrediction(): NewsAnalysis["marketPrediction"] {
  return {
    overallSentiment: "NEUTRAL",
    confidence: 50,
    summary: "Unable to analyze news at this time",
    keyFactors: [],
    affectedSymbols: [],
    tradingRecommendation: "Monitor market conditions",
    riskLevel: "MEDIUM",
  };
}

// Generate article-style text for history display
function generateArticleText(prediction: NewsAnalysis["marketPrediction"], newsCount: number, analysisType?: string): string {
  if (!prediction) return "";
  
  const sentimentText = prediction.overallSentiment === "BULLISH" ? "optimistic" :
                        prediction.overallSentiment === "BEARISH" ? "cautious" : "balanced";
  
  const riskText = prediction.riskLevel === "LOW" ? "relatively low-risk" :
                   prediction.riskLevel === "HIGH" ? "elevated risk" : "moderate risk";
  
  const keyFactorsText = prediction.keyFactors.length > 0 
    ? prediction.keyFactors.slice(0, 3).join(", ")
    : "current market developments";
  
  const symbolImpacts = prediction.affectedSymbols.slice(0, 3).map(s => 
    `${s.symbol} (${s.impact.toLowerCase()})`
  ).join(", ") || "various market sectors";
  
  const analysisTypeText = analysisType === "hourly" ? "hourly market" : "market";
  
  const paragraphs = [
    `Our latest ${analysisTypeText} analysis, based on ${newsCount} recent financial news sources, presents a ${sentimentText} outlook on market conditions. With a confidence level of ${prediction.confidence}%, our AI models have identified several key factors driving current market sentiment and price movements.`,
    
    `${prediction.summary} The analysis indicates a ${riskText} environment for traders, with particular attention warranted on ${keyFactorsText}. These factors are expected to influence short-term price action across multiple asset classes.`,
    
    `Key assets affected by current conditions include ${symbolImpacts}. Our recommendation: ${prediction.tradingRecommendation}. Traders should monitor these developments closely and adjust positions according to their individual risk tolerance and investment objectives.`,
    
    `This analysis incorporates real-time news sentiment, technical indicators, and historical pattern recognition to provide actionable market intelligence. As market conditions can change rapidly, we recommend regular review of updated analyses to maintain optimal trading positions.`
  ];
  
  return paragraphs.join("\n\n");
}

// ============================================
// Cached News Analysis Functions
// ============================================

// Cache staleness threshold (10 minutes)
const CACHE_STALE_MINUTES = 10;

// Flag to prevent multiple simultaneous background refreshes
let isRefreshing = false;

// Convert database snapshot to NewsAnalysis marketPrediction format
function snapshotToMarketPrediction(snapshot: NewsAnalysisSnapshot): NewsAnalysis["marketPrediction"] {
  return {
    overallSentiment: snapshot.overallSentiment as "BULLISH" | "BEARISH" | "NEUTRAL",
    confidence: snapshot.confidence,
    summary: snapshot.summary,
    keyFactors: snapshot.keyFactors ? JSON.parse(snapshot.keyFactors) : [],
    affectedSymbols: snapshot.affectedSymbols ? JSON.parse(snapshot.affectedSymbols) : [],
    tradingRecommendation: snapshot.tradingRecommendation || "Monitor market conditions",
    riskLevel: (snapshot.riskLevel as "LOW" | "MEDIUM" | "HIGH") || "MEDIUM",
  };
}

// Save AI prediction to cache
async function saveAnalysisToCache(prediction: NewsAnalysis["marketPrediction"], newsCount: number): Promise<void> {
  if (!prediction) return;
  
  try {
    const generatedArticle = generateArticleText(prediction, newsCount, "regular");
    
    const snapshot: InsertNewsAnalysisSnapshot = {
      overallSentiment: prediction.overallSentiment,
      confidence: prediction.confidence,
      summary: prediction.summary,
      keyFactors: JSON.stringify(prediction.keyFactors),
      affectedSymbols: JSON.stringify(prediction.affectedSymbols),
      tradingRecommendation: prediction.tradingRecommendation,
      riskLevel: prediction.riskLevel,
      newsCount: newsCount,
      analyzedAt: new Date(),
      analysisType: "regular",
      generatedArticle: generatedArticle,
    };
    
    await storage.saveNewsAnalysisSnapshot(snapshot);
    
    // Clean up old snapshots (keep last 10)
    await storage.deleteOldNewsAnalysisSnapshots(10);
    
    console.log("[NewsService] Analysis cached successfully");
  } catch (error) {
    console.error("[NewsService] Failed to cache analysis:", error);
  }
}

// Background refresh function (non-blocking)
async function backgroundRefresh(): Promise<void> {
  if (isRefreshing) {
    console.log("[NewsService] Background refresh already in progress");
    return;
  }
  
  isRefreshing = true;
  console.log("[NewsService] Starting background refresh...");
  
  try {
    const news = await fetchNews(10);
    if (news.length > 0) {
      const prediction = await analyzeNewsWithAI(news);
      if (prediction) {
        await saveAnalysisToCache(prediction, news.length);
      }
    }
    console.log("[NewsService] Background refresh completed");
  } catch (error) {
    console.error("[NewsService] Background refresh failed:", error);
  } finally {
    isRefreshing = false;
  }
}

// Extended NewsAnalysis with cache metadata
export interface CachedNewsAnalysis extends NewsAnalysis {
  isCached: boolean;
  cacheAge?: number; // Age in minutes
  isRefreshing: boolean;
}

// Get news analysis with caching for fast page loads
export async function getNewsAndAnalysisCached(): Promise<CachedNewsAnalysis> {
  try {
    // Try to get cached analysis first
    const cachedSnapshot = await storage.getLatestNewsAnalysisSnapshot();
    
    if (cachedSnapshot) {
      const ageMs = Date.now() - cachedSnapshot.analyzedAt.getTime();
      const ageMinutes = Math.round(ageMs / 60000);
      
      // Get stored news articles for display
      const storedArticles = await storage.getNewsArticles(10);
      const news: NewsItem[] = storedArticles.map(article => ({
        title: article.title,
        link: article.link,
        pubDate: article.publishedAt?.toISOString() || article.fetchedAt.toISOString(),
        content: article.content || "",
        source: article.source || "News",
      }));
      
      const cachedResult: CachedNewsAnalysis = {
        fetchedAt: cachedSnapshot.analyzedAt.toISOString(),
        newsCount: news.length || cachedSnapshot.newsCount,
        news: news.length > 0 ? news : [],
        marketPrediction: snapshotToMarketPrediction(cachedSnapshot),
        isCached: true,
        cacheAge: ageMinutes,
        isRefreshing: isRefreshing,
      };
      
      // Trigger background refresh if cache is stale
      if (ageMinutes >= CACHE_STALE_MINUTES && !isRefreshing) {
        console.log(`[NewsService] Cache is ${ageMinutes}min old, triggering background refresh`);
        backgroundRefresh(); // Don't await - run in background
      }
      
      return cachedResult;
    }
    
    // No cache available - fetch fresh data
    console.log("[NewsService] No cache available, fetching fresh data...");
    const news = await fetchNews(10);
    const prediction = await analyzeNewsWithAI(news);
    
    // Save to cache for next time
    if (prediction) {
      await saveAnalysisToCache(prediction, news.length);
    }
    
    return {
      fetchedAt: new Date().toISOString(),
      newsCount: news.length,
      news,
      marketPrediction: prediction,
      isCached: false,
      cacheAge: 0,
      isRefreshing: false,
    };
  } catch (error: any) {
    // Try to return cached data even on error
    const cachedSnapshot = await storage.getLatestNewsAnalysisSnapshot();
    if (cachedSnapshot) {
      return {
        fetchedAt: cachedSnapshot.analyzedAt.toISOString(),
        newsCount: cachedSnapshot.newsCount,
        news: [],
        marketPrediction: snapshotToMarketPrediction(cachedSnapshot),
        isCached: true,
        cacheAge: Math.round((Date.now() - cachedSnapshot.analyzedAt.getTime()) / 60000),
        isRefreshing: false,
        error: error.message || "Failed to refresh news",
      };
    }
    
    return {
      fetchedAt: new Date().toISOString(),
      newsCount: 0,
      news: [],
      marketPrediction: null,
      error: error.message || "Failed to fetch news",
      isCached: false,
      isRefreshing: false,
    };
  }
}

// Force refresh (bypasses cache)
export async function forceRefreshNewsAnalysis(): Promise<CachedNewsAnalysis> {
  console.log("[NewsService] Force refresh requested");
  
  const news = await fetchNews(10);
  const prediction = await analyzeNewsWithAI(news);
  
  if (prediction) {
    await saveAnalysisToCache(prediction, news.length);
  }
  
  return {
    fetchedAt: new Date().toISOString(),
    newsCount: news.length,
    news,
    marketPrediction: prediction,
    isCached: false,
    cacheAge: 0,
    isRefreshing: false,
  };
}

// ============================================
// Enhanced Hourly AI Analysis
// Runs every hour with full article content and historical context
// ============================================

interface HourlyAnalysisResult {
  success: boolean;
  articlesAnalyzed: number;
  historicalPredictionsUsed: number;
  prediction: NewsAnalysis["marketPrediction"] | null;
  error?: string;
}

/**
 * Enhanced hourly AI analysis that:
 * 1. Reads FULL article content from the last 1 hour (not just RSS summaries)
 * 2. Uses last 7 days of stored AI predictions as supplemental context
 * 3. Generates comprehensive market prediction and stores to database
 */
export async function runHourlyAiAnalysis(): Promise<HourlyAnalysisResult> {
  console.log("[NewsService] Starting hourly AI analysis...");
  
  const openai = await getOpenAIClient();
  if (!openai) {
    console.log("[NewsService] OpenAI not configured, skipping hourly analysis");
    return {
      success: false,
      articlesAnalyzed: 0,
      historicalPredictionsUsed: 0,
      prediction: null,
      error: "OpenAI not configured"
    };
  }
  
  try {
    // Step 1: Get full news articles from the last 1 hour
    const recentArticles = await storage.getNewsArticlesLastHour();
    console.log(`[NewsService] Found ${recentArticles.length} articles from last hour`);
    
    // Step 2: Get last 7 days of AI predictions for historical context
    const historicalPredictions = await storage.getNewsAnalysisSnapshotsLast7Days();
    console.log(`[NewsService] Found ${historicalPredictions.length} historical predictions from last 7 days`);
    
    // Get supported symbols from database
    const monitoredSymbols = await storage.getMonitoredSymbols();
    const supportedSymbols = monitoredSymbols
      .filter(s => s.isActive)
      .map(s => s.symbol);
    
    if (supportedSymbols.length === 0) {
      supportedSymbols.push("XAUUSD", "XAGUSD", "BTCUSD");
    }
    
    // Build full article context (complete content, not just summaries)
    const articleContext = recentArticles.length > 0 
      ? recentArticles.map((article, i) => {
          const publishedTime = article.publishedAt 
            ? new Date(article.publishedAt).toISOString()
            : new Date(article.fetchedAt).toISOString();
          return `ARTICLE ${i + 1}:
Title: ${article.title}
Source: ${article.source || "Unknown"}
Published: ${publishedTime}
Full Content:
${article.content || "No content available"}
---`;
        }).join("\n\n")
      : "No new articles in the last hour.";
    
    // Build historical prediction context
    const historicalContext = historicalPredictions.length > 0
      ? historicalPredictions.slice(0, 10).map((pred, i) => {
          const analyzedTime = new Date(pred.analyzedAt).toISOString();
          return `PREDICTION ${i + 1} (${analyzedTime}):
- Sentiment: ${pred.overallSentiment}
- Confidence: ${pred.confidence}%
- Summary: ${pred.summary}
- Risk Level: ${pred.riskLevel}
- Recommendation: ${pred.tradingRecommendation}`;
        }).join("\n\n")
      : "No historical predictions available.";
    
    // Generate comprehensive AI analysis
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert financial analyst performing a comprehensive HOURLY market analysis.

Your task is to analyze recent news articles in depth and combine this with historical AI predictions to generate an accurate market outlook.

ANALYSIS APPROACH:
1. READ AND ANALYZE each article thoroughly - extract key financial implications, market sentiment drivers, and trading signals
2. CORRELATE with historical predictions - identify trends, patterns, and whether recent predictions were accurate
3. SYNTHESIZE a comprehensive market prediction

Focus on these trading instruments: ${supportedSymbols.join(", ")}

Respond in JSON format with this exact structure:
{
  "overallSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 0-100,
  "summary": "Detailed 3-5 sentence market outlook based on FULL article analysis and historical context",
  "keyFactors": ["Factor 1 with specific detail from articles", "Factor 2", "Factor 3", "Factor 4"],
  "affectedSymbols": [
    {"symbol": "XAUUSD", "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL", "reason": "Specific reason from article analysis"}
  ],
  "tradingRecommendation": "Detailed actionable recommendation with risk context",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "historicalTrendNote": "Brief note on how current analysis aligns with or differs from recent 7-day predictions"
}

BE CONSERVATIVE with confidence scores - markets are uncertain.
If articles lack clear trading signals, default to NEUTRAL with appropriate explanation.`
        },
        {
          role: "user",
          content: `Perform comprehensive hourly analysis based on:

=== RECENT NEWS ARTICLES (Last 1 Hour) ===
${articleContext}

=== HISTORICAL AI PREDICTIONS (Last 7 Days) ===
${historicalContext}

Generate your market prediction now.`
        }
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }
    
    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[NewsService] No JSON found in hourly analysis response");
      return {
        success: false,
        articlesAnalyzed: recentArticles.length,
        historicalPredictionsUsed: historicalPredictions.length,
        prediction: null,
        error: "Invalid AI response format"
      };
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    const prediction: NewsAnalysis["marketPrediction"] = {
      overallSentiment: parsed.overallSentiment || "NEUTRAL",
      confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
      summary: parsed.summary || "Analysis completed",
      keyFactors: parsed.keyFactors || [],
      affectedSymbols: parsed.affectedSymbols || [],
      tradingRecommendation: parsed.tradingRecommendation || "Monitor market conditions",
      riskLevel: parsed.riskLevel || "MEDIUM",
    };
    
    // Generate article text for history display
    const generatedArticle = generateArticleText(prediction, recentArticles.length, "hourly");
    
    // Save enhanced analysis to database with source tracking
    const snapshot: InsertNewsAnalysisSnapshot = {
      overallSentiment: prediction.overallSentiment,
      confidence: prediction.confidence,
      summary: prediction.summary,
      keyFactors: JSON.stringify(prediction.keyFactors),
      affectedSymbols: JSON.stringify(prediction.affectedSymbols),
      tradingRecommendation: prediction.tradingRecommendation,
      riskLevel: prediction.riskLevel,
      newsCount: recentArticles.length,
      analyzedAt: new Date(),
      sourceArticles: JSON.stringify(recentArticles.map(a => a.id)),
      historicalContext: JSON.stringify({
        predictionsUsed: historicalPredictions.length,
        historicalTrendNote: parsed.historicalTrendNote || null,
        lastPredictionSentiments: historicalPredictions.slice(0, 5).map(p => p.overallSentiment)
      }),
      analysisType: "hourly",
      generatedArticle: generatedArticle,
    };
    
    await storage.saveNewsAnalysisSnapshot(snapshot);
    
    // Keep last 168 snapshots (7 days of hourly data)
    await storage.deleteOldNewsAnalysisSnapshots(168);
    
    console.log(`[NewsService] Hourly AI analysis completed: ${prediction.overallSentiment} (${prediction.confidence}% confidence)`);
    console.log(`[NewsService] Analyzed ${recentArticles.length} articles with ${historicalPredictions.length} historical predictions`);
    
    return {
      success: true,
      articlesAnalyzed: recentArticles.length,
      historicalPredictionsUsed: historicalPredictions.length,
      prediction
    };
    
  } catch (error: any) {
    console.error("[NewsService] Hourly AI analysis failed:", error.message);
    return {
      success: false,
      articlesAnalyzed: 0,
      historicalPredictionsUsed: 0,
      prediction: null,
      error: error.message
    };
  }
}

// Legacy function - kept for backward compatibility
export async function getNewsAndAnalysis(): Promise<NewsAnalysis> {
  try {
    const news = await fetchNews(10);
    const prediction = await analyzeNewsWithAI(news);

    return {
      fetchedAt: new Date().toISOString(),
      newsCount: news.length,
      news,
      marketPrediction: prediction,
    };
  } catch (error: any) {
    return {
      fetchedAt: new Date().toISOString(),
      newsCount: 0,
      news: [],
      marketPrediction: null,
      error: error.message || "Failed to fetch news",
    };
  }
}

// ============================================
// News Storage Functions (7-day retention for AI learning)
// ============================================

function generateLinkHash(link: string): string {
  return crypto.createHash('sha256').update(link).digest('hex');
}

interface FetchedNewsItem {
  title: string;
  link: string;
  pubDate: string;
  content: string;
  source: string;
  feedId?: number;
}

async function fetchFromSingleFeedWithMeta(
  feedUrl: string, 
  feedName: string, 
  feedId: number | undefined,
  maxItems: number
): Promise<FetchedNewsItem[]> {
  try {
    const feed = await parser.parseURL(feedUrl);
    
    return feed.items.slice(0, maxItems).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: item.pubDate || new Date().toISOString(),
      content: item.contentSnippet || item.content || "",
      source: feedName || feed.title || "News",
      feedId,
    }));
  } catch (error: any) {
    console.error(`[NewsService] Failed to fetch RSS feed ${feedName}:`, error.message);
    return [];
  }
}

export async function fetchAndStoreNews(): Promise<{ stored: number; total: number }> {
  console.log("[NewsService] Starting scheduled news fetch and store...");
  
  const feeds = await storage.getRssFeeds();
  const activeFeeds = feeds.filter(f => f.isActive);
  
  if (activeFeeds.length === 0) {
    console.log("[NewsService] No active RSS feeds configured");
    return { stored: 0, total: 0 };
  }
  
  const feedPromises = activeFeeds.map(feed => 
    fetchFromSingleFeedWithMeta(feed.url, feed.name, feed.id, 20)
  );
  
  const results = await Promise.all(feedPromises);
  const allNews = results.flat();
  
  if (allNews.length === 0) {
    console.log("[NewsService] No news items fetched from any feed");
    return { stored: 0, total: 0 };
  }
  
  const articlesToInsert: InsertNewsArticle[] = allNews.map(item => ({
    feedId: item.feedId || null,
    title: item.title,
    link: item.link,
    linkHash: generateLinkHash(item.link),
    content: item.content,
    source: item.source,
    publishedAt: item.pubDate ? new Date(item.pubDate) : null,
    fetchedAt: new Date(),
    sentiment: null,
    affectedSymbols: null,
    aiAnalysis: null,
  }));
  
  const inserted = await storage.insertNewsArticleBatch(articlesToInsert);
  
  console.log(`[NewsService] Stored ${inserted.length}/${allNews.length} new articles (duplicates skipped)`);
  
  return { stored: inserted.length, total: allNews.length };
}

export async function cleanupOldNews(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const deleted = await storage.deleteOldNewsArticles(sevenDaysAgo);
  
  if (deleted > 0) {
    console.log(`[NewsService] Cleaned up ${deleted} articles older than 7 days`);
  }
  
  return deleted;
}

export async function getStoredNewsCount(): Promise<number> {
  return storage.getNewsArticlesCount();
}

export async function getStoredNews(limit: number = 100): Promise<NewsArticle[]> {
  return storage.getNewsArticles(limit);
}

export async function getStoredNewsSince(hours: number = 24): Promise<NewsArticle[]> {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  return storage.getNewsArticlesSince(since);
}

export async function getNewsAndAnalysisWithHistory(historyHours: number = 24): Promise<NewsAnalysis> {
  try {
    const storedArticles = await getStoredNewsSince(historyHours);
    
    const news: NewsItem[] = storedArticles.map(article => ({
      title: article.title,
      link: article.link,
      pubDate: article.publishedAt?.toISOString() || article.fetchedAt.toISOString(),
      content: article.content || "",
      source: article.source || "News",
    }));
    
    if (news.length === 0) {
      const freshNews = await fetchNews(10);
      const prediction = await analyzeNewsWithAI(freshNews);
      
      return {
        fetchedAt: new Date().toISOString(),
        newsCount: freshNews.length,
        news: freshNews,
        marketPrediction: prediction,
      };
    }
    
    const prediction = await analyzeNewsWithAI(news.slice(0, 20));
    
    return {
      fetchedAt: new Date().toISOString(),
      newsCount: news.length,
      news: news.slice(0, 20),
      marketPrediction: prediction,
    };
  } catch (error: any) {
    console.error("[NewsService] Failed to get news with history:", error);
    return {
      fetchedAt: new Date().toISOString(),
      newsCount: 0,
      news: [],
      marketPrediction: null,
      error: error.message || "Failed to fetch news",
    };
  }
}

export async function getNewsStats(): Promise<{
  totalArticles: number;
  last24Hours: number;
  last7Days: number;
  oldestArticle: Date | null;
  newestArticle: Date | null;
}> {
  return storage.getNewsArticlesStats();
}
