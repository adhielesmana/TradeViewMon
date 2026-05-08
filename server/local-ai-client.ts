import { storage } from "./storage";

// Supported providers
export type AiProvider = "ollama" | "groq" | "openai-compat";

interface AiConfig {
  provider: AiProvider;
  url: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

interface ChatCompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
}

// Provider defaults
const PROVIDER_DEFAULTS: Record<AiProvider, { url: string; model: string }> = {
  ollama: { url: "http://localhost:11434", model: "qwen2.5:3b" },
  groq: { url: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  "openai-compat": { url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;

export async function getAiConfig(): Promise<AiConfig> {
  const provider = (
    process.env.AI_PROVIDER
    || (await storage.getSetting("AI_PROVIDER"))
    || "ollama"
  ) as AiProvider;

  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.ollama;

  const url = (
    process.env.AI_API_URL
    || (await storage.getSetting("AI_API_URL"))
    || (provider === "ollama" ? (process.env.OLLAMA_URL || defaults.url) : defaults.url)
  ).replace(/\/+$/, "");

  const model =
    process.env.AI_MODEL
    || (await storage.getSetting("AI_MODEL"))
    || (provider === "ollama" ? (process.env.OLLAMA_MODEL || defaults.model) : defaults.model);

  const apiKey =
    process.env.AI_API_KEY
    || (await storage.getSetting("AI_API_KEY"))
    || (provider === "groq" ? process.env.GROQ_API_KEY : null)
    || null;

  const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "", 10)
    || (provider === "ollama" ? 180000 : DEFAULT_TIMEOUT_MS);

  return { provider, url, model, apiKey, timeoutMs };
}

// Legacy compat
export async function getOllamaConfig() {
  const config = await getAiConfig();
  return { url: config.url, model: config.model, timeoutMs: config.timeoutMs };
}

export async function isOllamaAvailable(): Promise<boolean> {
  return isAiAvailable();
}

export async function isAiAvailable(): Promise<boolean> {
  try {
    const config = await getAiConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    if (config.provider === "ollama") {
      const res = await fetch(`${config.url}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } else {
      // OpenAI-compatible: check /models endpoint
      const headers: Record<string, string> = {};
      if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
      const res = await fetch(`${config.url}/models`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    }
  } catch {
    return false;
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const config = await getAiConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    if (config.provider === "ollama") {
      const res = await fetch(`${config.url}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name);
    } else {
      const headers: Record<string, string> = {};
      if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
      const res = await fetch(`${config.url}/models`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data || []).map((m) => m.id);
    }
  } catch {
    return [];
  }
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const config = await getAiConfig();
  const model = options.model || config.model;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      await new Promise((r) => setTimeout(r, delay));
      console.log(`[LocalAI] Retry attempt ${attempt}/${MAX_RETRIES} for ${config.provider}/${model}`);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let result: ChatCompletionResult;

      if (config.provider === "ollama") {
        result = await callOllama(config, model, options, controller.signal);
      } else {
        result = await callOpenAICompat(config, model, options, controller.signal);
      }

      clearTimeout(timer);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === "AbortError") {
        lastError = new Error(`AI request timed out after ${config.timeoutMs}ms (${config.provider})`);
      }
    }
  }

  throw lastError || new Error("AI request failed");
}

// --- Ollama native API ---
async function callOllama(
  config: AiConfig,
  model: string,
  options: ChatCompletionOptions,
  signal: AbortSignal,
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
    options: {
      num_ctx: 4096,
    } as Record<string, unknown>,
  };

  if (options.temperature !== undefined) {
    (body.options as Record<string, unknown>).temperature = options.temperature;
  }
  if (options.maxTokens !== undefined) {
    (body.options as Record<string, unknown>).num_predict = options.maxTokens;
  }
  if (options.jsonMode) {
    body.format = "json";
  }

  const res = await fetch(`${config.url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error");
    throw new Error(`Ollama returned ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    model?: string;
    eval_count?: number;
    prompt_eval_count?: number;
  };

  return {
    content: data.message?.content || "{}",
    model: data.model || model,
    tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0),
  };
}

// --- OpenAI-compatible API (Groq, DeepSeek, OpenRouter, etc.) ---
async function callOpenAICompat(
  config: AiConfig,
  model: string,
  options: ChatCompletionOptions,
  signal: AbortSignal,
): Promise<ChatCompletionResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
  };

  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(`${config.url}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error");
    throw new Error(`${config.provider} returned ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { total_tokens?: number };
  };

  return {
    content: data.choices?.[0]?.message?.content || "{}",
    model: data.model || model,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}
