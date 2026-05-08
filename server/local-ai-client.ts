import { storage } from "./storage";

interface OllamaConfig {
  url: string;
  model: string;
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

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen2.5:3b";
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;

export async function getOllamaConfig(): Promise<OllamaConfig> {
  const url = process.env.OLLAMA_URL
    || (await storage.getSetting("OLLAMA_URL"))
    || DEFAULT_URL;

  const model = process.env.OLLAMA_MODEL
    || (await storage.getSetting("OLLAMA_MODEL"))
    || DEFAULT_MODEL;

  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || "", 10)
    || DEFAULT_TIMEOUT_MS;

  return { url: url.replace(/\/+$/, ""), model, timeoutMs };
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const config = await getOllamaConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${config.url}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const config = await getOllamaConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${config.url}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name: string }> };
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const config = await getOllamaConfig();
  const model = options.model || config.model;

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    stream: false,
    options: {} as Record<string, unknown>,
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

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      await new Promise((r) => setTimeout(r, delay));
      console.log(`[LocalAI] Retry attempt ${attempt}/${MAX_RETRIES} for model ${model}`);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      const res = await fetch(`${config.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "unknown error");
        throw new Error(`Ollama returned ${res.status}: ${errorText}`);
      }

      const data = await res.json() as {
        message?: { content?: string };
        model?: string;
        eval_count?: number;
        prompt_eval_count?: number;
      };

      const content = data.message?.content || "{}";
      const tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0);

      return { content, model: data.model || model, tokensUsed };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === "AbortError") {
        lastError = new Error(`Ollama request timed out after ${config.timeoutMs}ms`);
      }
    }
  }

  throw lastError || new Error("Ollama request failed");
}
