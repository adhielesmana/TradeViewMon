/**
 * Ollama Local AI Client
 *
 * Wraps Ollama's native REST API without npm dependencies.
 * Ollama exposes an OpenAI-compatible chat completion endpoint at /api/chat
 */

import { storage } from "./storage";
import { decrypt } from "./encryption";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  tokensUsed?: number;
}

interface OllamaConfig {
  url: string;
  model: string;
  timeoutMs: number;
}

// Cache for Ollama config
let cachedConfig: OllamaConfig | null = null;
let cachedConfigTime = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get Ollama configuration from environment variables or database settings
 */
async function getOllamaConfig(): Promise<OllamaConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && now - cachedConfigTime < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  // Priority 1: Environment variables (best for production)
  const envUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const envModel = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";
  const envTimeout = parseInt(process.env.OLLAMA_TIMEOUT_MS || "180000", 10);

  // Priority 2: Check database for custom settings
  try {
    const dbUrl = await storage.getSetting("OLLAMA_URL");
    const dbModel = await storage.getSetting("OLLAMA_MODEL");

    if (dbUrl || dbModel) {
      cachedConfig = {
        url: dbUrl || envUrl,
        model: dbModel || envModel,
        timeoutMs: envTimeout,
      };
      cachedConfigTime = now;
      return cachedConfig;
    }
  } catch (e) {
    console.error("[Ollama Client] Failed to retrieve config from database:", e);
  }

  // Use environment defaults
  cachedConfig = {
    url: envUrl,
    model: envModel,
    timeoutMs: envTimeout,
  };
  cachedConfigTime = now;

  return cachedConfig;
}

/**
 * Check if Ollama is available and accessible
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const config = await getOllamaConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.url}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      return response.ok;
    } catch (e) {
      clearTimeout(timeoutId);
      return false;
    }
  } catch (e) {
    return false;
  }
}

/**
 * List available Ollama models
 */
export async function listModels(): Promise<string[]> {
  try {
    const config = await getOllamaConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.url}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      return (data.models || []).map(m => m.name);
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  } catch (e) {
    console.error("[Ollama Client] Failed to list models:", e);
    return [];
  }
}

/**
 * Chat completion with retry logic and exponential backoff
 */
export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const config = await getOllamaConfig();
  const model = options.model || config.model;
  const maxRetries = 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

      const requestBody: Record<string, unknown> = {
        model,
        messages: options.messages,
        stream: false,
        keep_alive: -1,
        options: {
          temperature: options.temperature ?? 0.7,
          num_ctx: 1024,
          num_predict: options.maxTokens || 400,
          num_thread: parseInt(process.env.OLLAMA_NUM_THREADS || "0", 10) || undefined,
        },
      };

      // Add JSON mode if requested (Ollama supports this)
      if (options.jsonMode) {
        requestBody.format = "json";
      }

      const response = await fetch(`${config.url}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { message?: { content: string }; model?: string };
      const content = data.message?.content || "";

      return {
        content,
        model: data.model || model,
        tokensUsed: undefined, // Ollama doesn't provide token counts in API response
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, etc.
        const backoffMs = 500 * Math.pow(2, attempt);
        console.warn(
          `[Ollama Client] Attempt ${attempt + 1} failed, retrying in ${backoffMs}ms:`,
          lastError.message
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw new Error(
    `[Ollama Client] Failed after ${maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * Pre-warm the model so it stays loaded in RAM (avoids cold-start penalty on first real request)
 */
async function warmupModel(): Promise<void> {
  try {
    const config = await getOllamaConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    await fetch(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        keep_alive: "30m",
        options: { num_predict: 1, num_ctx: 512 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log(`[Ollama Client] Model ${config.model} pre-warmed and loaded in RAM`);
  } catch (e) {
    // Non-fatal — model will load on first real request
    console.warn("[Ollama Client] Warmup skipped:", (e as Error).message);
  }
}

/**
 * Initialize Ollama on startup (log configuration and pre-warm model)
 */
async function initializeOllama() {
  try {
    const config = await getOllamaConfig();
    const available = await isOllamaAvailable();

    if (available) {
      console.log(`[Ollama Client] Initialized and connected - URL: ${config.url}, Model: ${config.model}`);
      // Pre-warm model in background (don't block startup)
      warmupModel().catch(() => {});
    } else {
      console.warn(
        `[Ollama Client] Configured but not available - URL: ${config.url}. Will gracefully fall back to technical analysis.`
      );
    }
  } catch (e) {
    console.warn("[Ollama Client] Failed to initialize:", e);
  }
}

// Initialize on import
initializeOllama().catch(e => {
  console.error("[Ollama Client] Startup error:", e);
});

export { getOllamaConfig };
