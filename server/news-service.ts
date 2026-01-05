import Parser from "rss-parser";
import OpenAI from "openai";
import crypto from "crypto";
import { storage } from "./storage";
import { decrypt } from "./encryption";
import type { InsertNewsArticle, NewsArticle } from "@shared/schema";

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
  // Priority 1: Database stored encrypted key (Settings page)
  const encryptedKey = await storage.getSetting("OPENAI_API_KEY_ENCRYPTED");
  if (encryptedKey) {
    try {
      const decryptedKey = decrypt(encryptedKey);
      return new OpenAI({
        apiKey: decryptedKey,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
    } catch (e) {
      console.error("[NewsService] Failed to decrypt OpenAI key:", e);
    }
  }

  // Priority 2: Replit's managed OpenAI integration
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (replitKey && replitKey !== "not-configured") {
    return new OpenAI({
      apiKey: replitKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  // Priority 3: Standard OPENAI_API_KEY environment variable
  const standardKey = process.env.OPENAI_API_KEY;
  if (standardKey) {
    return new OpenAI({ apiKey: standardKey });
  }

  return null;
}

export async function getRssFeedUrl(): Promise<string> {
  const savedUrl = await storage.getSetting("RSS_FEED_URL");
  return savedUrl || DEFAULT_RSS_URL;
}

export async function setRssFeedUrl(url: string): Promise<void> {
  await storage.setSetting("RSS_FEED_URL", url);
}

async function fetchFromSingleFeed(feedUrl: string, feedName: string, maxItems: number): Promise<NewsItem[]> {
  try {
    const feed = await parser.parseURL(feedUrl);
    
    return feed.items.slice(0, maxItems).map((item) => ({
      title: item.title || "Untitled",
      link: item.link || "",
      pubDate: item.pubDate || new Date().toISOString(),
      content: item.contentSnippet || item.content || "",
      source: feedName || feed.title || "News",
    }));
  } catch (error: any) {
    console.error(`[NewsService] Failed to fetch RSS feed ${feedName}:`, error);
    return []; // Return empty array for failed feeds, continue with others
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

  const supportedSymbols = ["XAUUSD", "XAGUSD", "BTCUSD", "GDX", "GDXJ", "NEM", "SPX", "DXY", "USOIL", "US10Y"];

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
