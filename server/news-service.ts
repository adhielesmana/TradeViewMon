import Parser from "rss-parser";
import crypto from "crypto";
import { storage } from "./storage";
import { chatCompletion, isOllamaAvailable } from "./local-ai-client";
import { resolveRelevantImage } from "./article-image-service";
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
    headline?: string;
    overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: number;
    summary: string;
    articleContent?: string;
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
  const ollamaAvailable = await isOllamaAvailable();

  if (!ollamaAvailable) {
    // Ollama not available - return null to show message in UI
    console.log("[NewsService] Ollama not available, skipping AI analysis");
    return null;
  }

  if (news.length === 0) {
    // No news to analyze - return default rather than null
    return getDefaultPrediction();
  }

  const newsContext = news.slice(0, 8)
    .map((item, i) => `${i + 1}. ${item.title}`)
    .join("\n");

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
    const response = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `You are a professional financial journalist and market analyst.
Your PRIMARY job is to ACCURATELY SUMMARIZE the provided news articles and then assess their market impact on these instruments: ${supportedSymbols.join(", ")}.

CRITICAL RULES:
- Your summary and article MUST faithfully reflect what the source news articles ACTUALLY say. DO NOT change the meaning, invent new narratives, or write about topics not covered in the articles.
- If an article is about geopolitics (e.g. US-Iran tensions, China strategy), your summary MUST be about that topic - do NOT turn it into a generic "market outlook" piece.
- The "headline" must capture the MAIN STORY from the articles, not a generic market title.
- The "articleContent" must be a 3-4 paragraph news-style article that summarizes the ACTUAL news, then explains its potential market implications. Start with what the news says, THEN discuss market impact.

LANGUAGE RULE (MANDATORY):
- You MUST write ALL text fields (headline, summary, articleContent, keyFactors, tradingRecommendation, and reason in affectedSymbols) in the SAME LANGUAGE as the source articles.
- If the source articles are in Indonesian, write EVERYTHING in Indonesian.
- If the source articles are in English, write EVERYTHING in English.
- If there is a mix of languages, use the language of the MAJORITY of articles.
- ONLY the JSON field names and enum values (BULLISH/BEARISH/NEUTRAL, POSITIVE/NEGATIVE, LOW/MEDIUM/HIGH) stay in English.

Respond in JSON format with this exact structure:
{
  "headline": "A headline reflecting the ACTUAL main story from the articles",
  "overallSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 0-100,
  "summary": "Brief 2-3 sentence summary of what the news articles ACTUALLY report",
  "articleContent": "A 3-4 paragraph article. Paragraph 1-2: Accurately summarize the key news stories. Paragraph 3-4: Explain the potential market implications for traders. Separate paragraphs with double newlines.",
  "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
  "affectedSymbols": [
    {"symbol": "XAUUSD", "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL", "reason": "Brief reason"}
  ],
  "tradingRecommendation": "Brief actionable recommendation",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}

IMPORTANT:
- The "headline" must read like a real news headline but MUST reflect the actual news content.
- The "articleContent" must START with what the news actually says before discussing market impact.
- NEVER fabricate information not present in the source articles.
- NEVER translate to a different language - write in the SAME language as the source articles.`,
        },
        {
          role: "user",
          content: `Summarize and analyze these recent financial news items. Stay faithful to the original content:\n\n${newsContext}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 2000,
      jsonMode: true,
    });

    const content = response.content;
    if (!content) {
      throw new Error("Empty response from Ollama");
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[NewsService] No JSON found in Ollama response, using defaults");
      return getDefaultPrediction();
    }

    let prediction;
    try {
      prediction = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.warn("[NewsService] Failed to parse JSON from Ollama, using defaults:", parseError);
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
      articleContent: typeof prediction.articleContent === "string" ? prediction.articleContent : undefined,
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
  // Return null instead of fake content — callers should
  // fall back to the latest real snapshot from the database
  return null;
}

function isRealPrediction(prediction: NewsAnalysis["marketPrediction"]): boolean {
  if (!prediction) return false;
  if (!prediction.headline || prediction.headline === "Markets Await Key Economic Developments") return false;
  if (prediction.summary === "Unable to analyze news at this time") return false;
  return true;
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

// Save AI prediction to cache — only real AI results, never fallback content
async function saveAnalysisToCache(prediction: NewsAnalysis["marketPrediction"], newsCount: number): Promise<void> {
  if (!prediction || !isRealPrediction(prediction)) {
    console.log("[NewsService] Skipping cache save — not a real AI prediction");
    return;
  }

  try {
    // Dedup: skip if the latest snapshot already has the same headline
    const latestSnapshot = await storage.getLatestNewsAnalysisSnapshot();
    if (latestSnapshot && prediction.headline && latestSnapshot.headline === prediction.headline) {
      console.log("[NewsService] Skipping duplicate snapshot (same headline as latest)");
      return;
    }

    const generatedArticle = prediction.articleContent || generateArticleText(prediction, newsCount, "regular");
    const imageResolution = await resolveRelevantImage({
      headline: prediction.headline || prediction.summary.slice(0, 50),
      summary: prediction.summary,
    });

    // Never save trady-logo as snapshot image — use a topic-relevant fallback instead
    let snapshotImageUrl = imageResolution.imageUrl;
    if (snapshotImageUrl === "/trady-logo.jpg" || snapshotImageUrl.startsWith("/trady-")) {
      const headlineForImage = prediction.headline || prediction.summary;
      snapshotImageUrl = getFallbackImage(headlineForImage, Math.abs(hashCode(headlineForImage)));
      console.log(`[NewsService] Replaced trady-logo with topic fallback: ${snapshotImageUrl.slice(0, 80)}...`);
    }

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
      imageUrl: snapshotImageUrl,
    };
    
    await storage.saveNewsAnalysisSnapshot(snapshot);
    
    // Clean up old snapshots (keep last 336 - 14 days of hourly data)
    await storage.deleteOldNewsAnalysisSnapshots(336);
    
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

  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("[NewsService] Ollama not available, skipping hourly analysis");
    return {
      success: false,
      articlesAnalyzed: 0,
      historicalPredictionsUsed: 0,
      prediction: null,
      error: "Ollama service not available"
    };
  }
  
  try {
    // Step 1: Get full news articles from the last 1 hour
    const recentArticles = await storage.getNewsArticlesLastHour();
    console.log(`[NewsService] Found ${recentArticles.length} articles from last hour`);
    
    // Step 2: Get last 14 days of AI predictions for historical context
    const historicalPredictions = await storage.getNewsAnalysisSnapshotsLast14Days();
    console.log(`[NewsService] Found ${historicalPredictions.length} historical predictions from last 14 days`);
    
    // Get supported symbols from database
    const monitoredSymbols = await storage.getMonitoredSymbols();
    const supportedSymbols = monitoredSymbols
      .filter(s => s.isActive)
      .map(s => s.symbol);
    
    if (supportedSymbols.length === 0) {
      supportedSymbols.push("XAUUSD", "XAGUSD", "BTCUSD");
    }

    // Build ultra-compact article context (headlines only, max 5)
    const limitedArticles = recentArticles.slice(0, 5);
    const articleContext = limitedArticles.length > 0
      ? limitedArticles.map((article, i) => `${i + 1}. ${article.title}`).join("\n")
      : "No new articles in the last hour.";

    // Skip historical context to save tokens
    const lastSentiment = historicalPredictions.length > 0
      ? historicalPredictions[0].overallSentiment
      : "NEUTRAL";

    // Generate AI analysis (optimized for low-resource Ollama inference)
    const response = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `You are an expert financial journalist and market analyst performing a comprehensive HOURLY analysis.

Your PRIMARY job is to ACCURATELY SUMMARIZE the provided news articles and then assess their market impact.

CRITICAL RULES - YOU MUST FOLLOW THESE:
1. Your summary, headline, and articleContent MUST faithfully reflect what the source articles ACTUALLY say. DO NOT change the meaning, invent new narratives, or write about topics not in the articles.
2. If articles discuss geopolitics (wars, diplomacy, sanctions), your output MUST cover those geopolitical topics - do NOT reduce them to generic market commentary.
3. The "articleContent" is the MOST IMPORTANT field - it must be a proper news article that FIRST summarizes the actual news, THEN discusses market implications.

LANGUAGE RULE (MANDATORY):
- You MUST write ALL text fields (headline, summary, articleContent, keyFactors, tradingRecommendation, historicalTrendNote, and reason in affectedSymbols) in the SAME LANGUAGE as the source articles.
- If the source articles are in Indonesian, write EVERYTHING in Indonesian.
- If the source articles are in English, write EVERYTHING in English.
- If there is a mix of languages, use the language of the MAJORITY of articles.
- ONLY the JSON field names and enum values (BULLISH/BEARISH/NEUTRAL, POSITIVE/NEGATIVE, LOW/MEDIUM/HIGH) stay in English.
- NEVER translate to a different language - match the source language exactly.

ANALYSIS APPROACH:
1. READ each article thoroughly and SUMMARIZE what it actually says
2. IDENTIFY market implications based on the actual news content
3. CORRELATE with historical predictions for context

Focus on these trading instruments: ${supportedSymbols.join(", ")}

Respond in JSON format with this exact structure:
{
  "headline": "A headline reflecting the ACTUAL main story from the articles (not generic market title)",
  "overallSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": 0-100,
  "summary": "3-5 sentence summary of what the news articles ACTUALLY report and their market implications",
  "articleContent": "A 3-5 paragraph news-style article. Paragraphs 1-2: Accurately summarize the key news stories and what they report. Paragraphs 3-4: Explain market implications for traders. Paragraph 5: Trading outlook. Separate paragraphs with double newlines (\\n\\n).",
  "keyFactors": ["Specific factor from articles", "Factor 2", "Factor 3", "Factor 4"],
  "affectedSymbols": [
    {"symbol": "XAUUSD", "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL", "reason": "Specific reason from article analysis"}
  ],
  "tradingRecommendation": "Detailed actionable recommendation with risk context",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "historicalTrendNote": "Brief note on how current analysis aligns with or differs from recent predictions"
}

IMPORTANT:
- The "headline" MUST reflect the actual news, not a generic market title.
- The "articleContent" MUST start with what the news actually says before discussing market impact.
- NEVER fabricate information not present in the source articles.
- BE CONSERVATIVE with confidence scores - markets are uncertain.`
        },
        {
          role: "user",
          content: `Summarize and analyze these news articles. Stay faithful to their actual content:

=== RECENT NEWS ARTICLES (Last 1 Hour) ===
${articleContext}

=== HISTORICAL AI PREDICTIONS (Last 14 Days, for context only) ===
${historicalContext}

Write your analysis now. Remember: accurately summarize the news FIRST, then discuss market impact.`
        }
      ],
      temperature: 0.3,
      maxTokens: 2000,
      jsonMode: true,
    });

    const content = response.content;
    if (!content) {
      throw new Error("Empty response from Ollama");
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
      articleContent: typeof parsed.articleContent === "string" ? parsed.articleContent : undefined,
      keyFactors: parsed.keyFactors || [],
      affectedSymbols: parsed.affectedSymbols || [],
      tradingRecommendation: parsed.tradingRecommendation || "Monitor market conditions",
      riskLevel: parsed.riskLevel || "MEDIUM",
    };

    // Only save real AI predictions — never persist fallback/default content
    if (!isRealPrediction(prediction)) {
      console.log("[NewsService] Hourly analysis produced non-real prediction, skipping save");
      return {
        success: false,
        articlesAnalyzed: recentArticles.length,
        historicalPredictionsUsed: historicalPredictions.length,
        prediction: null,
        error: "AI produced unusable prediction"
      };
    }

    // Use AI-generated article content, fall back to template if not available
    const generatedArticle = prediction.articleContent || generateArticleText(prediction, recentArticles.length, "hourly");

    // Pick the most relevant stored image from the source articles if available.
    const rssImageUrl = recentArticles.find(a => a.imageUrl)?.imageUrl;
    const imageResolution = await resolveRelevantImage({
      headline: prediction.headline || prediction.summary.slice(0, 50),
      summary: prediction.summary,
      sourceImageUrl: rssImageUrl,
    });

    // Never save trady-logo as snapshot image — use a topic-relevant fallback instead
    let hourlyImageUrl = imageResolution.imageUrl;
    if (hourlyImageUrl === "/trady-logo.jpg" || hourlyImageUrl.startsWith("/trady-")) {
      const headlineForImage = prediction.headline || prediction.summary;
      hourlyImageUrl = getFallbackImage(headlineForImage, Math.abs(hashCode(headlineForImage)));
      console.log(`[NewsService] Replaced trady-logo with topic fallback: ${hourlyImageUrl.slice(0, 80)}...`);
    }

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
      imageUrl: hourlyImageUrl,
    };

    // Dedup: skip if the latest snapshot already has the same headline
    const latestSnapshot = await storage.getLatestNewsAnalysisSnapshot();
    if (latestSnapshot && prediction.headline && latestSnapshot.headline === prediction.headline) {
      console.log(`[NewsService] Skipping duplicate hourly snapshot (same headline: "${prediction.headline?.slice(0, 50)}")`);
    } else {
      await storage.saveNewsAnalysisSnapshot(snapshot);
    }
    
    // Keep last 336 snapshots (14 days of hourly data)
    await storage.deleteOldNewsAnalysisSnapshots(336);
    
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

// Image keyword extraction - simple rule-based approach (no AI needed)
async function extractImageKeywordsWithAI(headline: string, summary: string): Promise<string> {
  try {
    // Use simple rule-based keyword extraction instead of AI
    // No need to call AI for just image keywords
    const keywords = extractKeywordsFromHeadline(headline);
    const keywordString = keywords.join(" ");
    console.log(`[NewsService] Extracted image keywords: "${keywordString}" for: ${headline.slice(0, 50)}...`);
    return keywordString;
  } catch (error: any) {
    console.error("[NewsService] Image keyword extraction failed:", error.message);
    return extractKeywordsFromHeadline(headline).join(" ");
  }
}

// Get AI-powered relevant image for an article
export async function getAIRelevantImage(headline: string, summary: string, articleId: number): Promise<string> {
  const imageResolution = await resolveRelevantImage({
    headline,
    summary,
  });
  console.log(`[NewsService] Resolved image for article ${articleId}: ${imageResolution.sourceType} (${imageResolution.relevanceScore}%)`);
  return imageResolution.imageUrl;
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

// Backfill images for articles that need normalization or are still using external URLs
export async function backfillArticleImages(): Promise<{ updated: number; total: number }> {
  console.log("[NewsService] Starting article image normalization...");
  
  try {
    const recentArticles = await storage.getNewsArticles(50);
    const articlesToNormalize = recentArticles;

    if (articlesToNormalize.length === 0) {
      console.log("[NewsService] No articles need image backfill");
      return { updated: 0, total: 0 };
    }
    
    let updated = 0;
    
    for (const article of articlesToNormalize) {
      const imageResolution = await resolveRelevantImage({
        headline: article.title,
        summary: article.content || "",
        sourceImageUrl: article.imageUrl || null,
      });

      // Never backfill with trady-logo — use topic-relevant fallback instead
      let resolvedUrl = imageResolution.imageUrl;
      if (resolvedUrl === "/trady-logo.jpg" || resolvedUrl.startsWith("/trady-")) {
        resolvedUrl = getFallbackImage(article.title, article.id);
      }

      if (article.imageUrl !== resolvedUrl) {
        await storage.updateArticleImageUrl(article.id, resolvedUrl);
        updated++;
      }
    }
    
    console.log(`[NewsService] Backfilled images for ${updated}/${articlesToNormalize.length} articles`);
    return { updated, total: articlesToNormalize.length };
    
  } catch (error: any) {
    console.error("[NewsService] Image backfill failed:", error.message);
    return { updated: 0, total: 0 };
  }
}

// Backfill images for snapshots that don't have them or still point to external URLs
export async function backfillSnapshotImages(): Promise<{ updated: number; total: number }> {
  console.log("[NewsService] Starting snapshot image normalization...");

  try {
    const snapshots = await storage.getAllNewsSnapshots();
    // Only backfill snapshots that have no image or still use external URLs
    // Skip snapshots that already have valid local /uploads/ images
    const snapshotsToNormalize = snapshots.filter(s => {
      if (!s.imageUrl) return true; // no image
      if (s.imageUrl.startsWith("/uploads/")) return false; // already has local image — keep it
      if (s.imageUrl.startsWith("/trady-logo") || s.imageUrl.startsWith("/trady-icon")) return false; // acceptable fallback
      if (s.imageUrl.startsWith("http")) return true; // external URL — needs normalization
      return false;
    });

    if (snapshotsToNormalize.length === 0) {
      console.log("[NewsService] No snapshots need image backfill");
      return { updated: 0, total: 0 };
    }

    let updated = 0;

    for (const snapshot of snapshotsToNormalize) {
      const headline = snapshot.headline || snapshot.summary.slice(0, 50);
      const imageResolution = await resolveRelevantImage({
        headline,
        summary: snapshot.summary,
        sourceImageUrl: snapshot.imageUrl || null,
      });

      // Never backfill with trady-logo — use topic-relevant fallback instead
      let resolvedUrl = imageResolution.imageUrl;
      if (resolvedUrl === "/trady-logo.jpg" || resolvedUrl.startsWith("/trady-")) {
        resolvedUrl = getFallbackImage(headline, Math.abs(hashCode(headline)));
      }

      if (snapshot.imageUrl !== resolvedUrl) {
        await storage.updateSnapshotImageUrl(snapshot.id, resolvedUrl);
        updated++;
      }
    }

    console.log(`[NewsService] Backfilled images for ${updated}/${snapshotsToNormalize.length} snapshots`);
    return { updated, total: snapshotsToNormalize.length };

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
      const headline = snapshot.headline || "market analysis";
      const summary = snapshot.summary || "";
      
      const imageResolution = await resolveRelevantImage({
        headline,
        summary,
        sourceImageUrl: snapshot.imageUrl || null,
        forceRefresh: forceAll,
      });

      // Never save trady-logo — use topic-relevant fallback instead
      let resolvedUrl = imageResolution.imageUrl;
      if (resolvedUrl === "/trady-logo.jpg" || resolvedUrl.startsWith("/trady-")) {
        resolvedUrl = getFallbackImage(headline, Math.abs(hashCode(headline)));
      }

      await storage.updateSnapshotImageUrl(snapshot.id, resolvedUrl);
      updated++;
      
      // Rate limit to avoid AI/image-service bursts
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
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  
  const deleted = await storage.deleteOldNewsArticles(fourteenDaysAgo);
  
  if (deleted > 0) {
    console.log(`[NewsService] Cleaned up ${deleted} articles older than 14 days`);
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
