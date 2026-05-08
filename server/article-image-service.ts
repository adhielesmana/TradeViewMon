import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { storage } from "./storage";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import type { InsertArticleImageCache } from "@shared/schema";

const ARTICLE_IMAGE_RETENTION_DAYS = 180;
const ARTICLE_IMAGE_RETENTION_MS = ARTICLE_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const LOCAL_IMAGE_DIR = path.join(process.cwd(), "uploads", "article-images");

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "as", "is", "was", "are", "were", "been", "be", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "must",
  "shall", "can", "need", "dare", "ought", "used", "this", "that", "these", "those",
  "i", "you", "he", "she", "it", "we", "they", "what", "which", "who", "whom",
  "its", "his", "her", "their", "our", "my", "your", "than", "then", "so", "if",
  "when", "where", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "too", "very", "just", "also", "now", "here", "there", "about", "into", "over",
  "after", "before", "between", "under", "again", "further", "once", "during"
]);

const TOPIC_PATTERNS: Array<{ pattern: string; canonical: string }> = [
  { pattern: "gold", canonical: "gold" },
  { pattern: "silver", canonical: "silver" },
  { pattern: "platinum", canonical: "platinum" },
  { pattern: "bitcoin", canonical: "bitcoin" },
  { pattern: "crypto", canonical: "crypto" },
  { pattern: "btc", canonical: "bitcoin" },
  { pattern: "ethereum", canonical: "ethereum" },
  { pattern: "stock", canonical: "stock-market" },
  { pattern: "market", canonical: "financial-market" },
  { pattern: "trading", canonical: "trading" },
  { pattern: "investor", canonical: "investor" },
  { pattern: "inflation", canonical: "inflation" },
  { pattern: "recession", canonical: "recession" },
  { pattern: "economy", canonical: "economy" },
  { pattern: "fed", canonical: "federal-reserve" },
  { pattern: "interest rate", canonical: "interest-rates" },
  { pattern: "interest", canonical: "interest-rates" },
  { pattern: "oil", canonical: "oil" },
  { pattern: "gas", canonical: "natural-gas" },
  { pattern: "energy", canonical: "energy" },
  { pattern: "bull", canonical: "bull-market" },
  { pattern: "bear", canonical: "bear-market" },
  { pattern: "rally", canonical: "rally" },
  { pattern: "surge", canonical: "surge" },
  { pattern: "drop", canonical: "drop" },
  { pattern: "crash", canonical: "crash" },
  { pattern: "tech", canonical: "technology" },
  { pattern: "mining", canonical: "mining" },
  { pattern: "bank", canonical: "banking" },
  { pattern: "china", canonical: "china" },
  { pattern: "usa", canonical: "usa" },
  { pattern: "united states", canonical: "usa" },
  { pattern: "europe", canonical: "europe" },
  { pattern: "japan", canonical: "japan" },
  { pattern: "india", canonical: "india" },
  { pattern: "middle east", canonical: "middle-east" },
  { pattern: "opec", canonical: "opec" },
];

export type ArticleImageSourceType = "rss" | "cache" | "fallback";

export interface ResolveArticleImageInput {
  headline: string;
  summary: string;
  sourceImageUrl?: string | null;
  forceRefresh?: boolean;
}

export interface ResolveArticleImageResult {
  imageUrl: string;
  storagePath: string | null;
  cacheKey: string;
  topicSignature: string;
  sourceType: ArticleImageSourceType;
  relevanceScore: number;
  reusedCache: boolean;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTopicTokens(headline: string, summary: string): string[] {
  const text = normalizeText(`${headline} ${summary}`);
  const tokens = new Set<string>();

  for (const { pattern, canonical } of TOPIC_PATTERNS) {
    if (text.includes(pattern)) {
      tokens.add(canonical);
    }
  }

  if (tokens.size === 0) {
    const fallbackTokens = text.match(/\b[a-z0-9]{3,}\b/g) || [];
    for (const token of fallbackTokens) {
      if (STOP_WORDS.has(token)) continue;
      tokens.add(token);
      if (tokens.size >= 6) break;
    }
  }

  return Array.from(tokens).sort();
}

function buildTopicSignature(headline: string, summary: string): string {
  const tokens = extractTopicTokens(headline, summary);
  if (tokens.length === 0) {
    const fallback = normalizeText(headline || summary || "market-analysis");
    return fallback.slice(0, 120) || "market-analysis";
  }
  return tokens.join("|");
}

function buildCacheKey(signature: string): string {
  return crypto.createHash("sha256").update(signature).digest("hex");
}

function buildKeywordsText(signature: string): string {
  return signature.split("|").join(", ");
}

export function isManagedImageUrl(imageUrl?: string | null): boolean {
  if (!imageUrl) return false;
  return imageUrl.startsWith("/objects/") || imageUrl.startsWith("/uploads/");
}

/** Check if a managed image file actually exists on disk */
async function managedImageExists(imageUrl: string): Promise<boolean> {
  if (!isManagedImageUrl(imageUrl)) return false;
  try {
    // /uploads/article-images/xxx.jpg -> <cwd>/uploads/article-images/xxx.jpg
    const filePath = path.join(process.cwd(), imageUrl);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mimeTypeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "png";
}

function inferSourceType(sourceImageUrl?: string | null): ArticleImageSourceType {
  if (!sourceImageUrl) return "fallback";
  return isManagedImageUrl(sourceImageUrl) ? "cache" : "rss";
}

async function ensureLocalImageDir(): Promise<void> {
  await fs.mkdir(LOCAL_IMAGE_DIR, { recursive: true });
}

async function storeImageBuffer(buffer: Buffer, mimeType: string): Promise<{ imageUrl: string; storagePath: string | null }> {
  const contentType = mimeType || "image/png";

  if (process.env.REPL_ID && process.env.PRIVATE_OBJECT_DIR) {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const response = await fetch(uploadURL, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: buffer,
      });

      if (!response.ok) {
        throw new Error(`Object storage upload failed with status ${response.status}`);
      }

      return { imageUrl: objectPath, storagePath: objectPath };
    } catch (error) {
      console.warn("[ArticleImageService] Object storage upload failed, falling back to local disk:", error);
    }
  }

  await ensureLocalImageDir();
  const extension = mimeTypeToExtension(contentType);
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(LOCAL_IMAGE_DIR, fileName);
  await fs.writeFile(filePath, buffer);

  return {
    imageUrl: `/uploads/article-images/${fileName}`,
    storagePath: `/uploads/article-images/${fileName}`,
  };
}

async function deleteStoredImage(imageUrl: string): Promise<void> {
  if (!isManagedImageUrl(imageUrl)) {
    return;
  }

  if (imageUrl.startsWith("/objects/")) {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
      await objectFile.delete();
    } catch (error) {
      console.warn("[ArticleImageService] Failed to delete object storage asset:", error);
    }
    return;
  }

  try {
    const filePath = path.join(process.cwd(), imageUrl);
    if (filePath.startsWith(path.join(process.cwd(), "uploads"))) {
      await fs.unlink(filePath);
    }
  } catch (error) {
    console.warn("[ArticleImageService] Failed to delete local image asset:", error);
  }
}

async function downloadRemoteImage(remoteUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(remoteUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Trady/1.0; +https://trady.replit.app)",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading image`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

export async function resolveRelevantImage(input: ResolveArticleImageInput): Promise<ResolveArticleImageResult> {
  const headline = input.headline?.trim() || "Market analysis";
  const summary = input.summary?.trim() || "";
  const topicSignature = buildTopicSignature(headline, summary);
  const cacheKey = buildCacheKey(topicSignature);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ARTICLE_IMAGE_RETENTION_MS);

  const cached = await storage.getArticleImageCacheByKey(cacheKey);
  if (
    cached &&
    !input.forceRefresh &&
    new Date(cached.expiresAt).getTime() > now.getTime() &&
    cached.sourceType !== "fallback"
  ) {
    const updated = await storage.markArticleImageCacheUsed(cacheKey, expiresAt);
    const imageUrl = updated?.imageUrl || cached.imageUrl;
    return {
      imageUrl,
      storagePath: updated?.storagePath || cached.storagePath || imageUrl,
      cacheKey,
      topicSignature,
      sourceType: "cache",
      relevanceScore: updated?.relevanceScore ?? cached.relevanceScore,
      reusedCache: true,
    };
  }

  let sourceType: ArticleImageSourceType = "fallback";
  let imageUrl = "";
  let storagePath: string | null = null;
  let sourceUrl: string | null = input.sourceImageUrl || null;

  if (input.sourceImageUrl && !input.forceRefresh) {
    if (isManagedImageUrl(input.sourceImageUrl) && await managedImageExists(input.sourceImageUrl)) {
      imageUrl = input.sourceImageUrl;
      storagePath = input.sourceImageUrl;
      sourceType = "cache";
    } else if (isManagedImageUrl(input.sourceImageUrl)) {
      // Managed URL but file missing (e.g. after container recreate) — try cache source_url
      const cachedEntry = cached || await storage.getArticleImageCacheByKey(cacheKey);
      if (cachedEntry?.sourceUrl && !isManagedImageUrl(cachedEntry.sourceUrl)) {
        try {
          const downloaded = await downloadRemoteImage(cachedEntry.sourceUrl);
          const stored = await storeImageBuffer(downloaded.buffer, downloaded.contentType);
          imageUrl = stored.imageUrl;
          storagePath = stored.storagePath;
          sourceType = "rss";
        } catch (error) {
          console.warn("[ArticleImageService] Failed to re-download from cached source URL:", error);
        }
      }
    } else {
      try {
        const downloaded = await downloadRemoteImage(input.sourceImageUrl);
        const stored = await storeImageBuffer(downloaded.buffer, downloaded.contentType);
        imageUrl = stored.imageUrl;
        storagePath = stored.storagePath;
        sourceType = inferSourceType(input.sourceImageUrl);
      } catch (error) {
        console.warn("[ArticleImageService] Failed to store source image:", error);
      }
    }
  }

  if (!imageUrl && input.sourceImageUrl) {
    if (isManagedImageUrl(input.sourceImageUrl) && await managedImageExists(input.sourceImageUrl)) {
      imageUrl = input.sourceImageUrl;
      storagePath = input.sourceImageUrl;
      sourceType = "cache";
    } else if (!isManagedImageUrl(input.sourceImageUrl)) {
      try {
        const downloaded = await downloadRemoteImage(input.sourceImageUrl);
        const stored = await storeImageBuffer(downloaded.buffer, downloaded.contentType);
        imageUrl = stored.imageUrl;
        storagePath = stored.storagePath;
        sourceType = inferSourceType(input.sourceImageUrl);
      } catch (error) {
        console.warn("[ArticleImageService] Falling back to placeholder after source download failed:", error);
      }
    }
  }

  // Last resort: search cache for a related topic image instead of falling back to logo
  if (!imageUrl) {
    const topicTokens = extractTopicTokens(headline, summary);
    const related = await storage.findRelatedArticleImage(topicTokens);
    if (related && related.imageUrl && isManagedImageUrl(related.imageUrl) && await managedImageExists(related.imageUrl)) {
      imageUrl = related.imageUrl;
      storagePath = related.storagePath || related.imageUrl;
      sourceType = "cache";
      console.log(`[ArticleImageService] Using related topic image: ${related.keywords} -> ${imageUrl}`);
    }
  }

  // Absolute last fallback — use the logo only if nothing else works
  if (!imageUrl) {
    imageUrl = "/trady-logo.jpg";
    storagePath = null;
    sourceType = "fallback";
    sourceUrl = null;
  }

  const existing = cached || await storage.getArticleImageCacheByKey(cacheKey);
  if (existing && existing.imageUrl !== imageUrl && isManagedImageUrl(existing.imageUrl)) {
    await deleteStoredImage(existing.imageUrl);
  }

  const cachedRecord: InsertArticleImageCache = {
    cacheKey,
    topicSignature,
    headline,
    summary,
    keywords: buildKeywordsText(topicSignature),
    sourceType,
    sourceUrl,
    imageUrl,
    storagePath,
    relevanceScore: 99.99,
    usageCount: 1,
    lastUsedAt: now,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  const persisted = await storage.upsertArticleImageCache(cachedRecord);

  return {
    imageUrl: persisted.imageUrl,
    storagePath: persisted.storagePath || persisted.imageUrl,
    cacheKey,
    topicSignature,
    sourceType: persisted.sourceType as ArticleImageSourceType,
    relevanceScore: persisted.relevanceScore,
    reusedCache: false,
  };
}

export async function cleanupExpiredArticleImages(): Promise<number> {
  const cutoff = new Date(Date.now() - ARTICLE_IMAGE_RETENTION_MS);
  let deleted = 0;

  for (let batch = 0; batch < 20; batch++) {
    const expired = await storage.getExpiredArticleImageCache(cutoff, 100);
    if (expired.length === 0) {
      break;
    }

    for (const record of expired) {
      if (isManagedImageUrl(record.imageUrl)) {
        await deleteStoredImage(record.imageUrl);
      }

      const removed = await storage.deleteArticleImageCache(record.id);
      if (removed) {
        deleted++;
      }
    }
  }

  if (deleted > 0) {
    console.log(`[ArticleImageService] Cleaned up ${deleted} expired article image cache entries`);
  }

  return deleted;
}
