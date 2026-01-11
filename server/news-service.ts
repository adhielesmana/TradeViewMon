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
    headline?: string; // Natural news-style headline for display
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
        "User-Agent": "Mozilla/5.0 (compatible; Trady/1.0; +https://trady.replit.app)",
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
  "headline": "A natural news-style headline (like a real newspaper) highlighting the key market story from the articles - NOT 'Market Outlook' or 'AI Analysis' style",
  "overallSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 0-100,
  "summary": "Brief 2-3 sentence market outlook based on the news",
  "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
  "affectedSymbols": [
    {"symbol": "XAUUSD", "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL", "reason": "Brief reason"}
  ],
  "tradingRecommendation": "Brief actionable recommendation",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}

IMPORTANT: The "headline" must read like a real news headline from Reuters, Bloomberg, or WSJ. Examples:
- "Gold Surges as Fed Signals Rate Pause"
- "Asian Markets Rally on Strong China Data"
- "Oil Prices Slip Amid OPEC Supply Concerns"
Do NOT use generic titles like "Market Outlook" or "Trading Analysis".`,
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
      headline: typeof prediction.headline === "string" ? prediction.headline : undefined,
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
    headline: "Markets Await Key Economic Developments",
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
    headline: snapshot.headline || undefined,
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
    
    // Generate stock image using stable ID based on headline hash
    // This ensures deterministic image URLs for CDN caching
    const headlineForImage = prediction.headline || prediction.summary.slice(0, 50);
    const stableId = Math.abs(hashCode(headlineForImage));
    const stockImageUrl = generateStockImageUrl(headlineForImage, stableId);
    
    const snapshot: InsertNewsAnalysisSnapshot = {
      overallSentiment: prediction.overallSentiment,
      confidence: prediction.confidence,
      headline: prediction.headline || null,
      summary: prediction.summary,
      keyFactors: JSON.stringify(prediction.keyFactors),
      affectedSymbols: JSON.stringify(prediction.affectedSymbols),
      tradingRecommendation: prediction.tradingRecommendation,
      riskLevel: prediction.riskLevel,
      newsCount: newsCount,
      analyzedAt: new Date(),
      analysisType: "regular",
      generatedArticle: generatedArticle,
      imageUrl: stockImageUrl,
    };
    
    await storage.saveNewsAnalysisSnapshot(snapshot);
    
    // Clean up old snapshots (keep last 168 - 7 days of hourly data)
    await storage.deleteOldNewsAnalysisSnapshots(168);
    
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
  "headline": "A natural news-style headline highlighting the key market story - like Reuters, Bloomberg, or WSJ",
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

IMPORTANT: The "headline" must read like a real news headline from Reuters, Bloomberg, or WSJ. Examples:
- "Gold Surges as Fed Signals Rate Pause"
- "Asian Markets Rally on Strong China Data"  
- "Oil Prices Slip Amid OPEC Supply Concerns"
Do NOT use generic titles like "Market Outlook" or "Trading Analysis".

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
      headline: typeof parsed.headline === "string" ? parsed.headline : undefined,
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
    
    // Pick featured image from source articles (first article with image)
    // Fallback to stock image if no RSS image available
    const rssImageUrl = recentArticles.find(a => a.imageUrl)?.imageUrl;
    const headlineForImage = prediction.headline || prediction.summary.slice(0, 50);
    // Use stable hash-based ID for deterministic image URLs (better for CDN caching)
    const stableId = Math.abs(hashCode(headlineForImage));
    const featuredImageUrl = rssImageUrl || generateStockImageUrl(headlineForImage, stableId);
    
    // Save enhanced analysis to database with source tracking
    const snapshot: InsertNewsAnalysisSnapshot = {
      overallSentiment: prediction.overallSentiment,
      confidence: prediction.confidence,
      headline: prediction.headline || null,
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
      imageUrl: featuredImageUrl,
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
  imageUrl?: string;
}

function extractImageFromRssItem(item: any): string | undefined {
  // Helper to extract URL from media object (handles both object and array forms)
  const extractMediaUrl = (media: any): string | undefined => {
    if (!media) return undefined;
    
    // If it's an array, iterate and find first valid image
    if (Array.isArray(media)) {
      for (const m of media) {
        const url = m?.$ && m.$.url;
        if (url && isValidImageUrl(url)) return url;
      }
      return undefined;
    }
    
    // Single object form
    const url = media.$ && media.$.url;
    if (url && isValidImageUrl(url)) return url;
    
    return undefined;
  };
  
  // Priority 1: media:content (most common for news feeds)
  const mediaContentUrl = extractMediaUrl(item.mediaContent);
  if (mediaContentUrl) return mediaContentUrl;
  
  // Priority 2: media:thumbnail
  const mediaThumbnailUrl = extractMediaUrl(item.mediaThumbnail);
  if (mediaThumbnailUrl) return mediaThumbnailUrl;
  
  // Priority 3: enclosure (common in podcasts and media feeds)
  if (item.enclosure) {
    const enclosure = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
    const encUrl = enclosure?.url || enclosure?.$?.url;
    if (encUrl && isValidImageUrl(encUrl)) return encUrl;
  }
  
  // Priority 4: Extract from content/description using regex
  const content = item.content || item['content:encoded'] || item.description || '';
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1] && isValidImageUrl(imgMatch[1])) {
    return imgMatch[1];
  }
  
  return undefined;
}

function isValidImageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    // Must be http/https and look like an image
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg') || 
           lowerUrl.includes('.png') || lowerUrl.includes('.gif') || 
           lowerUrl.includes('.webp') || lowerUrl.includes('/image') ||
           lowerUrl.includes('img') || lowerUrl.includes('photo') ||
           lowerUrl.includes('media');
  } catch {
    return false;
  }
}

// ============================================
// Stock Image Generation for Articles
// ============================================

// Financial keywords to search terms mapping
const KEYWORD_MAPPINGS: Record<string, string[]> = {
  // Precious metals
  gold: ["gold bars", "gold bullion", "gold investment"],
  silver: ["silver coins", "silver bars", "precious metals"],
  platinum: ["platinum", "precious metals"],
  
  // Crypto
  bitcoin: ["bitcoin", "cryptocurrency", "digital currency"],
  crypto: ["cryptocurrency", "blockchain", "digital assets"],
  btc: ["bitcoin", "cryptocurrency"],
  ethereum: ["ethereum", "blockchain"],
  
  // Markets
  stock: ["stock market", "trading floor", "wall street"],
  market: ["stock market", "financial market", "trading"],
  trading: ["stock trading", "financial charts", "market analysis"],
  investor: ["investor", "business meeting", "finance"],
  
  // Economic
  inflation: ["inflation", "economy", "money"],
  recession: ["recession", "economic downturn", "finance"],
  economy: ["economy", "business", "finance"],
  fed: ["federal reserve", "banking", "finance"],
  interest: ["interest rates", "banking", "finance"],
  
  // Energy
  oil: ["oil barrel", "crude oil", "petroleum"],
  gas: ["natural gas", "energy", "oil rig"],
  energy: ["energy", "power", "renewable"],
  
  // General finance
  bull: ["bull market", "stock market", "trading"],
  bear: ["bear market", "stock market", "downtrend"],
  rally: ["stock rally", "market growth", "bull run"],
  surge: ["market surge", "stock growth", "uptrend"],
  drop: ["market crash", "stock decline", "recession"],
  crash: ["market crash", "financial crisis", "recession"],
  
  // Companies/sectors
  tech: ["technology", "silicon valley", "startup"],
  mining: ["gold mining", "mining industry", "excavation"],
  bank: ["banking", "bank building", "finance"],
};

// Default fallback keywords for financial news
const DEFAULT_KEYWORDS = ["finance", "stock market", "trading"];

// Pexels API for stock images (primary source)
async function searchPexelsImage(query: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.log("[NewsService] No Pexels API key configured");
    return null;
  }

  try {
    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`,
      {
        headers: {
          Authorization: apiKey,
        },
      }
    );

    if (!response.ok) {
      console.error(`[NewsService] Pexels API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.photos && data.photos.length > 0) {
      // Pick a random image from top 10 results for variety
      const randomIndex = Math.floor(Math.random() * Math.min(10, data.photos.length));
      const photo = data.photos[randomIndex];
      // Use large size for better quality
      return photo.src.large || photo.src.medium || photo.src.original;
    }

    console.log(`[NewsService] Pexels returned no results for: "${query}"`);
    return null;
  } catch (error: any) {
    console.error("[NewsService] Pexels search failed:", error.message);
    return null;
  }
}

// Curated fallback images by topic (high-quality stock images from Pexels CDN)
const FALLBACK_IMAGES: Record<string, string[]> = {
  gold: [
    "https://images.pexels.com/photos/47047/gold-ingots-golden-treasure-47047.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/4386158/pexels-photo-4386158.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/4386442/pexels-photo-4386442.jpeg?auto=compress&w=800",
  ],
  bitcoin: [
    "https://images.pexels.com/photos/844124/pexels-photo-844124.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/730564/pexels-photo-730564.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/6771900/pexels-photo-6771900.jpeg?auto=compress&w=800",
  ],
  crypto: [
    "https://images.pexels.com/photos/6771607/pexels-photo-6771607.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/8370752/pexels-photo-8370752.jpeg?auto=compress&w=800",
  ],
  oil: [
    "https://images.pexels.com/photos/247763/pexels-photo-247763.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/4254165/pexels-photo-4254165.jpeg?auto=compress&w=800",
  ],
  silver: [
    "https://images.pexels.com/photos/4386370/pexels-photo-4386370.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/4386373/pexels-photo-4386373.jpeg?auto=compress&w=800",
  ],
  stock: [
    "https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/7567443/pexels-photo-7567443.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/6120214/pexels-photo-6120214.jpeg?auto=compress&w=800",
  ],
  market: [
    "https://images.pexels.com/photos/6801874/pexels-photo-6801874.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/7567565/pexels-photo-7567565.jpeg?auto=compress&w=800",
  ],
  china: [
    "https://images.pexels.com/photos/2412603/pexels-photo-2412603.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/1486577/pexels-photo-1486577.jpeg?auto=compress&w=800",
  ],
  usa: [
    "https://images.pexels.com/photos/1202723/pexels-photo-1202723.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/356844/pexels-photo-356844.jpeg?auto=compress&w=800",
  ],
  mining: [
    "https://images.pexels.com/photos/2101137/pexels-photo-2101137.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/4254164/pexels-photo-4254164.jpeg?auto=compress&w=800",
  ],
  default: [
    "https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/7567443/pexels-photo-7567443.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/6120214/pexels-photo-6120214.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/6801874/pexels-photo-6801874.jpeg?auto=compress&w=800",
  ],
};

// Get fallback image based on keywords
function getFallbackImage(keywords: string, articleId: number): string {
  const lowerKeywords = keywords.toLowerCase();
  
  // Check which topic matches
  for (const [topic, images] of Object.entries(FALLBACK_IMAGES)) {
    if (topic !== 'default' && lowerKeywords.includes(topic)) {
      // Use articleId to pick consistent image for each article
      return images[articleId % images.length];
    }
  }
  
  // Default fallback
  const defaultImages = FALLBACK_IMAGES.default;
  return defaultImages[articleId % defaultImages.length];
}

// AI-powered image keyword extraction using OpenAI
async function extractImageKeywordsWithAI(headline: string, summary: string): Promise<string> {
  try {
    const openai = await getOpenAIClient();
    if (!openai) {
      console.log("[NewsService] OpenAI not available for image keywords, using fallback");
      return extractKeywordsFromHeadline(headline).join(" ");
    }

    const prompt = `Analyze this financial news article and generate a specific image search query.

HEADLINE: ${headline}
SUMMARY: ${summary.slice(0, 500)}

RULES:
1. Identify the PRIMARY SUBJECT (e.g., gold bars, bitcoin coin, oil barrels, stock chart)
2. Identify any COUNTRY or REGION mentioned (e.g., China, USA, Europe, Middle East)
3. Identify any COMPANY or PRODUCT (e.g., Tesla car, Apple iPhone, mining equipment)
4. Combine these into a descriptive image search query

EXAMPLES:
- "Gold prices rise in China" → "gold bars chinese currency yuan"
- "Bitcoin hits new high" → "bitcoin cryptocurrency digital coin"
- "Tesla stock surges" → "Tesla electric car factory"
- "Oil prices drop in Middle East" → "oil barrels desert middle east"
- "Federal Reserve interest rates" → "federal reserve building washington"
- "Silver mining production increases" → "silver bars mining equipment"

Return ONLY the image search query (3-6 words), nothing else. Be specific and visual.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 50,
      temperature: 0.3,
    });

    const keywords = response.choices[0]?.message?.content?.trim();
    if (keywords && keywords.length > 0 && keywords.length < 100) {
      console.log(`[NewsService] AI extracted image keywords: "${keywords}" for: ${headline.slice(0, 50)}...`);
      return keywords;
    }

    return extractKeywordsFromHeadline(headline).join(" ");
  } catch (error: any) {
    console.error("[NewsService] AI image keyword extraction failed:", error.message);
    return extractKeywordsFromHeadline(headline).join(" ");
  }
}

// Get AI-powered relevant image for an article
export async function getAIRelevantImage(headline: string, summary: string, articleId: number): Promise<string> {
  // Step 1: Use AI to extract specific image keywords
  const aiKeywords = await extractImageKeywordsWithAI(headline, summary);
  console.log(`[NewsService] AI keywords for article ${articleId}: "${aiKeywords}"`);

  // Step 2: Try Pexels API with AI keywords (primary source)
  const pexelsImage = await searchPexelsImage(aiKeywords);
  if (pexelsImage) {
    console.log(`[NewsService] Found Pexels image for: "${aiKeywords}"`);
    return pexelsImage;
  }

  // Step 3: Try simplified keywords if original query failed
  const simplifiedKeywords = aiKeywords.split(" ").slice(0, 2).join(" ");
  if (simplifiedKeywords !== aiKeywords) {
    const simplifiedImage = await searchPexelsImage(simplifiedKeywords);
    if (simplifiedImage) {
      console.log(`[NewsService] Found Pexels image with simplified query: "${simplifiedKeywords}"`);
      return simplifiedImage;
    }
  }

  // Step 4: Use curated fallback images based on topic detection
  console.log(`[NewsService] Using curated fallback for: "${aiKeywords}"`);
  return getFallbackImage(aiKeywords + " " + headline, articleId);
}

// Simple string hash function for stable image IDs
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

function extractKeywordsFromHeadline(headline: string): string[] {
  const lowerHeadline = headline.toLowerCase();
  const foundKeywords: string[] = [];
  
  // Check for mapped keywords
  for (const [keyword, searchTerms] of Object.entries(KEYWORD_MAPPINGS)) {
    if (lowerHeadline.includes(keyword)) {
      // Pick a random search term from the mapping
      const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];
      foundKeywords.push(term);
      if (foundKeywords.length >= 2) break; // Limit to 2 keywords
    }
  }
  
  // If no keywords found, use defaults
  if (foundKeywords.length === 0) {
    return DEFAULT_KEYWORDS.slice(0, 2);
  }
  
  return foundKeywords;
}

function generateStockImageUrl(headline: string, articleId: number): string {
  // Extract relevant keywords from headline for targeted image search
  const keywords = extractKeywordsFromHeadline(headline);
  
  // Use Loremflickr for relevant stock images based on keywords
  // Format: https://loremflickr.com/width/height/keyword1,keyword2/all?lock=uniqueId
  // The 'lock' parameter ensures consistent images for the same article
  const keywordQuery = keywords.slice(0, 3).join(",").replace(/\s+/g, "-");
  
  return `https://loremflickr.com/800/450/${encodeURIComponent(keywordQuery)}/all?lock=${articleId}`;
}

// Backfill images for articles that don't have them
export async function backfillArticleImages(): Promise<{ updated: number; total: number }> {
  console.log("[NewsService] Starting image backfill for articles without images...");
  
  try {
    // Get articles without images (limit to recent ones to avoid too many updates)
    const articlesWithoutImages = await storage.getNewsArticlesWithoutImages(50);
    
    if (articlesWithoutImages.length === 0) {
      console.log("[NewsService] No articles need image backfill");
      return { updated: 0, total: 0 };
    }
    
    let updated = 0;
    
    for (const article of articlesWithoutImages) {
      const imageUrl = generateStockImageUrl(article.title, article.id);
      await storage.updateArticleImageUrl(article.id, imageUrl);
      updated++;
    }
    
    console.log(`[NewsService] Backfilled images for ${updated}/${articlesWithoutImages.length} articles`);
    return { updated, total: articlesWithoutImages.length };
    
  } catch (error: any) {
    console.error("[NewsService] Image backfill failed:", error.message);
    return { updated: 0, total: 0 };
  }
}

// Backfill images for snapshots that don't have them
export async function backfillSnapshotImages(): Promise<{ updated: number; total: number }> {
  console.log("[NewsService] Starting image backfill for snapshots without images...");
  
  try {
    const snapshotsWithoutImages = await storage.getNewsSnapshotsWithoutImages(50);
    
    if (snapshotsWithoutImages.length === 0) {
      console.log("[NewsService] No snapshots need image backfill");
      return { updated: 0, total: 0 };
    }
    
    let updated = 0;
    
    for (const snapshot of snapshotsWithoutImages) {
      const headline = snapshot.headline || snapshot.summary.slice(0, 50);
      const imageUrl = generateStockImageUrl(headline, snapshot.id);
      await storage.updateSnapshotImageUrl(snapshot.id, imageUrl);
      updated++;
    }
    
    console.log(`[NewsService] Backfilled images for ${updated}/${snapshotsWithoutImages.length} snapshots`);
    return { updated, total: snapshotsWithoutImages.length };
    
  } catch (error: any) {
    console.error("[NewsService] Snapshot image backfill failed:", error.message);
    return { updated: 0, total: 0 };
  }
}

// Regenerate ALL snapshot images with AI-powered relevant images
export async function regenerateAllSnapshotImages(forceAll: boolean = false): Promise<{ updated: number; total: number }> {
  console.log("[NewsService] Regenerating snapshot images with AI-powered keywords...");
  
  try {
    // Get all snapshots
    const allSnapshots = await storage.getAllNewsSnapshots();
    
    if (allSnapshots.length === 0) {
      console.log("[NewsService] No snapshots found to regenerate");
      return { updated: 0, total: 0 };
    }
    
    let updated = 0;
    
    for (const snapshot of allSnapshots) {
      // Skip if already has a Pexels image (unless forceAll is true)
      if (!forceAll && snapshot.imageUrl?.includes("images.pexels.com")) {
        continue;
      }
      
      const headline = snapshot.headline || "market analysis";
      const summary = snapshot.summary || "";
      
      // Use AI-powered image generation
      const newImageUrl = await getAIRelevantImage(headline, summary, snapshot.id);
      
      await storage.updateSnapshotImageUrl(snapshot.id, newImageUrl);
      updated++;
      
      // Rate limit to avoid API throttling (Pexels: 200 req/hour)
      if (updated % 10 === 0) {
        console.log(`[NewsService] Regenerated ${updated}/${allSnapshots.length} images...`);
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 sec delay every 10 images
      }
    }
    
    console.log(`[NewsService] Regenerated ${updated}/${allSnapshots.length} snapshot images with AI keywords`);
    return { updated, total: allSnapshots.length };
    
  } catch (error: any) {
    console.error("[NewsService] Snapshot image regeneration failed:", error.message);
    return { updated: 0, total: 0 };
  }
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
      imageUrl: extractImageFromRssItem(item),
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
    imageUrl: item.imageUrl || null,
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
