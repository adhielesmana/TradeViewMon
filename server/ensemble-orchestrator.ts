import type {
  MarketData,
  MonitoredSymbol,
  EnsembleSettings,
  EnsembleSummary,
  EnsembleModelContribution,
  EnsembleModelHealth,
  InsertMlModelAudit,
  InsertMlModelRegistryEntry,
  MlModelRegistryEntry,
  PredictionWithResult,
  Prediction,
  InsertPrediction,
  InsertAiSuggestion,
  AiSuggestion,
  EnsembleDirection,
} from "@shared/schema";
import { generateUnifiedSignal } from "./unified-signal-generator";
import { predictionEngine } from "./prediction-engine";
import { storage } from "./storage";

type SidecarModelStatus = "healthy" | "degraded" | "offline" | "training";

interface SidecarModelOutput {
  modelKey: string;
  displayName: string;
  role: string;
  direction: EnsembleDirection;
  confidence: number;
  forecastPrice: number;
  forecastLower: number;
  forecastUpper: number;
  rationale: string;
  status: SidecarModelStatus;
  weightHint?: number;
}

interface SidecarPredictResponse {
  symbol: string;
  marketScope: string;
  checkpoint: string | null;
  isStockFocused: boolean;
  fallbackUsed: boolean;
  currentPrice: number;
  modelOutputs: SidecarModelOutput[];
  sidecarConsensus: {
    direction: EnsembleDirection;
    confidence: number;
    trustScore: number;
    consensusScore: number;
    forecastPrice: number;
    forecastLower: number;
    forecastUpper: number;
    abstainReason?: string | null;
  };
  modelHealth: EnsembleModelHealth[];
  rawFeatureSummary?: Record<string, unknown>;
}

interface EnsembleAnalysisInput {
  symbol: string;
  candles: MarketData[];
  timeframe?: string;
  stepsAhead?: number;
  minutesAhead?: number;
  source?: "prediction" | "suggestion" | "backtest" | "manual";
  symbolProfile?: MonitoredSymbol | null;
  persist?: boolean;
}

interface EnsembleMergeResult {
  summary: EnsembleSummary;
  technicalSignal: ReturnType<typeof generateUnifiedSignal>;
  modelRegistry: MlModelRegistryEntry[];
  sidecarResponse?: SidecarPredictResponse | null;
  auditId?: number;
}

const DEFAULT_SETTINGS: EnsembleSettings = {
  trustThreshold: 68,
  consensusThreshold: 60,
  retrainCadenceHours: 24,
  activeCheckpoint: "stock-ensemble-v1",
  minCandles: 30,
  stockOnly: true,
  technicalWeight: 0.10,
  abstainOnDisagreement: true,
};

const SIDE_CAR_URL = (process.env.ML_SIDECAR_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
const SIDE_CAR_TIMEOUT_MS = 3500;
const MAX_SIDE_CAR_CANDLES = 240;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function scoreDirection(direction: EnsembleDirection): number {
  switch (direction) {
    case "UP":
      return 1;
    case "DOWN":
      return -1;
    default:
      return 0;
  }
}

function directionFromDecision(decision: "BUY" | "SELL" | "HOLD"): EnsembleDirection {
  if (decision === "BUY") return "UP";
  if (decision === "SELL") return "DOWN";
  return "NEUTRAL";
}

function decisionFromDirection(direction: EnsembleDirection): "BUY" | "SELL" | "HOLD" {
  if (direction === "UP") return "BUY";
  if (direction === "DOWN") return "SELL";
  return "HOLD";
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

function formatModelStatus(status: string | undefined): SidecarModelStatus {
  switch (status) {
    case "healthy":
    case "degraded":
    case "offline":
    case "training":
      return status;
    default:
      return "degraded";
  }
}

function buildTechnicalContribution(
  technicalSignal: ReturnType<typeof generateUnifiedSignal>,
  currentPrice: number,
  weight: number,
): EnsembleModelContribution {
  const direction = directionFromDecision(technicalSignal.decision);
  const support = technicalSignal.targets.buyTarget ?? currentPrice;
  const resistance = technicalSignal.targets.sellTarget ?? currentPrice;
  const forecastLower = direction === "DOWN"
    ? Math.min(currentPrice, support)
    : Math.min(currentPrice, support, technicalSignal.tradePlan?.stopLoss ?? currentPrice);
  const forecastUpper = direction === "UP"
    ? Math.max(currentPrice, resistance)
    : Math.max(currentPrice, resistance, technicalSignal.tradePlan?.takeProfit2 ?? currentPrice);

  return {
    modelKey: "technical",
    displayName: "Technical Guard",
    role: "guard",
    direction,
    confidence: technicalSignal.confidence,
    weight,
    weightedScore: scoreDirection(direction) * (technicalSignal.confidence / 100) * weight,
    forecastPrice: technicalSignal.targets.buyTarget && technicalSignal.targets.sellTarget
      ? (technicalSignal.targets.buyTarget + technicalSignal.targets.sellTarget) / 2
      : currentPrice,
    forecastLower,
    forecastUpper,
    rationale: technicalSignal.reasons.map(r => r.description).join("; ") || "Technical guard",
    status: "healthy",
    isTechnical: true,
  };
}

function buildFallbackModelContribution(
  modelKey: string,
  displayName: string,
  role: string,
  confidence: number,
  direction: EnsembleDirection,
  forecastPrice: number,
  currentPrice: number,
  weight: number,
  status: SidecarModelStatus = "degraded",
  rationale = "Fallback model output",
): EnsembleModelContribution {
  const forecastLower = Math.min(currentPrice, forecastPrice);
  const forecastUpper = Math.max(currentPrice, forecastPrice);
  return {
    modelKey,
    displayName,
    role,
    direction,
    confidence,
    weight,
    weightedScore: scoreDirection(direction) * (confidence / 100) * weight,
    forecastPrice,
    forecastLower,
    forecastUpper,
    rationale,
    status,
  };
}

function parseRegistryMetadata(entry: MlModelRegistryEntry): Record<string, unknown> {
  return safeJsonParse<Record<string, unknown>>(entry.metadata, {});
}

function isStockFocusedSymbol(symbol: string, profile?: MonitoredSymbol | null): boolean {
  const symbolLower = symbol.toLowerCase();
  const category = (profile?.category || "").toLowerCase();
  const displayName = (profile?.displayName || "").toLowerCase();
  const currency = (profile?.currency || "").toUpperCase();

  if (symbolLower.endsWith(".jk") || currency === "IDR") return true;
  if (category.includes("stock") || category.includes("equity") || category.includes("shares")) return true;
  if (displayName.includes("(idx)") || displayName.includes("stock")) return true;
  if (category.includes("mining")) return true;
  return false;
}

function inferMarketScope(symbol: string, profile?: MonitoredSymbol | null): string {
  return isStockFocusedSymbol(symbol, profile) ? "stocks" : "multi-asset";
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = SIDE_CAR_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Sidecar ${response.status} ${response.statusText}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFeatureSnapshot(
  symbol: string,
  candles: MarketData[],
  technicalSignal: ReturnType<typeof generateUnifiedSignal>,
  profile?: MonitoredSymbol | null,
  settings?: EnsembleSettings,
): Record<string, unknown> {
  const recentCandles = candles.slice(-MAX_SIDE_CAR_CANDLES);
  const lastPattern = technicalSignal.indicators.candlestickPatterns.at(-1);
  const sentiment = null;

  return {
    symbol,
    marketScope: inferMarketScope(symbol, profile),
    settings,
    symbolProfile: profile
      ? {
          symbol: profile.symbol,
          displayName: profile.displayName,
          category: profile.category,
          currency: profile.currency,
        }
      : null,
    currentPrice: technicalSignal.indicators.currentPrice,
    technicalSignal: {
      decision: technicalSignal.decision,
      confidence: technicalSignal.confidence,
      bullishScore: technicalSignal.bullishScore,
      bearishScore: technicalSignal.bearishScore,
      netScore: technicalSignal.netScore,
      reasons: technicalSignal.reasons,
      support: technicalSignal.targets.buyTarget,
      resistance: technicalSignal.targets.sellTarget,
      atr: technicalSignal.indicators.atr,
      rsi14: technicalSignal.indicators.rsi14,
      macdHistogram: technicalSignal.indicators.macdHistogram,
      pattern: lastPattern
        ? {
            name: lastPattern.name,
            type: lastPattern.type,
            strength: lastPattern.strength,
          }
        : null,
    },
    sentiment,
    candles: recentCandles.map((candle) => ({
      timestamp: candle.timestamp.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      interval: candle.interval,
    })),
  };
}

function mergeModelContributions(
  currentPrice: number,
  technicalSignal: ReturnType<typeof generateUnifiedSignal>,
  modelOutputs: SidecarModelOutput[],
  modelRegistry: MlModelRegistryEntry[],
  settings: EnsembleSettings,
): {
  contributions: EnsembleModelContribution[];
  direction: EnsembleDirection;
  confidence: number;
  consensusScore: number;
  trustScore: number;
  predictedPrice: number;
  forecastLower: number;
  forecastUpper: number;
  abstainReason: string | null;
} {
  const registryMap = new Map(modelRegistry.map((entry) => [entry.modelKey, entry]));
  const technicalContribution = buildTechnicalContribution(technicalSignal, currentPrice, settings.technicalWeight);
  const modelContributions = modelOutputs
    .filter((output) => registryMap.get(output.modelKey)?.isEnabled !== false)
    .map((output) => {
      const registry = registryMap.get(output.modelKey);
      const weight = normalizeWeight(registry?.weight ?? output.weightHint, 0.1);
      return {
        modelKey: output.modelKey,
        displayName: output.displayName,
        role: output.role,
        direction: output.direction,
        confidence: output.confidence,
        weight,
        weightedScore: scoreDirection(output.direction) * (output.confidence / 100) * weight,
        forecastPrice: output.forecastPrice,
        forecastLower: output.forecastLower,
        forecastUpper: output.forecastUpper,
        rationale: output.rationale,
        status: formatModelStatus(output.status),
      } satisfies EnsembleModelContribution;
    });

  const contributions = [technicalContribution, ...modelContributions];
  const activeContributions = contributions.filter((item) => item.weight > 0);
  const totalWeight = activeContributions.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weightedScore = activeContributions.reduce((sum, item) => sum + item.weightedScore, 0);
  const rawDirection = weightedScore > 0.02 ? "UP" : weightedScore < -0.02 ? "DOWN" : "NEUTRAL";
  const consensusScore = activeContributions.length > 0
    ? Math.round(
        (activeContributions
          .filter((item) => item.direction === rawDirection && item.direction !== "NEUTRAL")
          .reduce((sum, item) => sum + item.weight, 0) / totalWeight) * 100,
      )
    : 0;

  const confidenceScore = activeContributions.reduce(
    (sum, item) => sum + ((item.confidence / 100) * item.weight),
    0,
  ) / totalWeight * 100;

  const forecastPrice = activeContributions.reduce(
    (sum, item) => sum + (item.forecastPrice * item.weight),
    0,
  ) / totalWeight;

  const forecastLower = activeContributions.reduce(
    (sum, item) => sum + (item.forecastLower * item.weight),
    0,
  ) / totalWeight;

  const forecastUpper = activeContributions.reduce(
    (sum, item) => sum + (item.forecastUpper * item.weight),
    0,
  ) / totalWeight;

  const healthyCount = activeContributions.filter((item) => item.status === "healthy").length;
  const degradedCount = activeContributions.filter((item) => item.status === "degraded").length;
  const offlineCount = activeContributions.filter((item) => item.status === "offline").length;
  const healthScore = clamp(
    100 - (degradedCount * 12) - (offlineCount * 30) - (activeContributions.length < 3 ? 20 : 0),
    0,
    100,
  );

  const priceSpread = forecastUpper > 0 && forecastLower > 0
    ? Math.abs(forecastUpper - forecastLower) / Math.max(forecastUpper, forecastLower)
    : 0;
  const spreadPenalty = priceSpread > 0.05 ? 18 : priceSpread > 0.03 ? 8 : 0;

  const trustScore = clamp(
    (consensusScore * 0.45) + (confidenceScore * 0.35) + (healthScore * 0.20) - spreadPenalty,
    0,
    100,
  );

  const directionContribution = activeContributions.reduce(
    (sum, item) => sum + (scoreDirection(item.direction) * item.weight),
    0,
  );
  const decisionDirection = directionContribution > 0.02 ? "UP" : directionContribution < -0.02 ? "DOWN" : "NEUTRAL";

  const abstainReasons: string[] = [];
  if (settings.abstainOnDisagreement && rawDirection === "NEUTRAL") {
    abstainReasons.push("Model consensus is neutral");
  }
  if (trustScore < settings.trustThreshold) {
    abstainReasons.push(`Trust score ${trustScore.toFixed(1)} below threshold ${settings.trustThreshold}`);
  }
  if (consensusScore < settings.consensusThreshold) {
    abstainReasons.push(`Consensus score ${consensusScore}% below threshold ${settings.consensusThreshold}%`);
  }
  if (spreadPenalty > 0) {
    abstainReasons.push("Forecast spread is too wide");
  }
  if (offlineCount > 0) {
    abstainReasons.push(`${offlineCount} model(s) returned degraded/offline status`);
  }

  return {
    contributions,
    direction: decisionDirection,
    confidence: Math.round(confidenceScore * 10) / 10,
    consensusScore,
    trustScore: Math.round(trustScore * 10) / 10,
    predictedPrice: Math.round(forecastPrice * 100) / 100,
    forecastLower: Math.round(forecastLower * 100) / 100,
    forecastUpper: Math.round(forecastUpper * 100) / 100,
    abstainReason: abstainReasons.length > 0 ? abstainReasons.join("; ") : null,
  };
}

export class EnsembleOrchestrator {
  private settingsCache: { value: EnsembleSettings; updatedAt: number } | null = null;

  private async loadSettings(): Promise<EnsembleSettings> {
    if (this.settingsCache && Date.now() - this.settingsCache.updatedAt < 30_000) {
      return this.settingsCache.value;
    }

    const raw = await storage.getSetting("ENSEMBLE_CONFIG_JSON");
    const parsed = safeJsonParse<Partial<EnsembleSettings>>(raw, {});
    const value: EnsembleSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };

    this.settingsCache = { value, updatedAt: Date.now() };
    return value;
  }

  async getSettings(): Promise<EnsembleSettings> {
    return this.loadSettings();
  }

  invalidateSettingsCache(): void {
    this.settingsCache = null;
  }

  async saveSettings(partial: Partial<EnsembleSettings>): Promise<EnsembleSettings> {
    const current = await this.loadSettings();
    const next: EnsembleSettings = {
      ...current,
      ...partial,
    };

    await storage.setSetting("ENSEMBLE_CONFIG_JSON", JSON.stringify(next));
    this.invalidateSettingsCache();
    return next;
  }

  private buildTechnicalSummary(
    symbol: string,
    marketScope: string,
    technicalSignal: ReturnType<typeof generateUnifiedSignal>,
    settings: EnsembleSettings,
    currentPrice: number,
    modelRegistry: MlModelRegistryEntry[],
    isStockFocused: boolean,
  ): EnsembleSummary {
    const technicalContribution = buildTechnicalContribution(technicalSignal, currentPrice, settings.technicalWeight);
    const decision = technicalSignal.decision !== "HOLD" && technicalSignal.confidence >= settings.trustThreshold
      ? technicalSignal.decision
      : "HOLD";

    return {
      symbol,
      marketScope,
      isStockFocused,
      decision,
      direction: directionFromDecision(technicalSignal.decision),
      confidence: technicalSignal.confidence,
      trustScore: Math.round(Math.min(technicalSignal.confidence * 0.85, 100) * 10) / 10,
      consensusScore: decision === "HOLD" ? 0 : 100,
      predictedPrice: technicalContribution.forecastPrice,
      forecastLower: technicalContribution.forecastLower,
      forecastUpper: technicalContribution.forecastUpper,
      currentPrice,
      modelType: "local_stock_ensemble_v1",
      checkpoint: settings.activeCheckpoint,
      generatedAt: new Date().toISOString(),
      fallbackUsed: true,
      abstainReason: "Technical fallback only - ensemble service unavailable or not applicable",
      technicalSignal: {
        signal: technicalSignal.decision,
        strength: technicalSignal.confidence,
        reasons: technicalSignal.reasons.map((reason) => reason.description),
      },
      modelContributions: [technicalContribution],
      modelHealth: modelRegistry.map((entry) => ({
        modelKey: entry.modelKey,
        displayName: entry.displayName,
        status: formatModelStatus(entry.status),
        version: entry.version || null,
        checkpoint: entry.checkpoint || null,
        lastTrainedAt: entry.lastTrainedAt?.toISOString() || null,
        weight: entry.weight,
        role: entry.role,
      })),
    };
  }

  async getModelRegistry(): Promise<MlModelRegistryEntry[]> {
    const registry = await storage.getMlModelRegistry();
    if (registry.length > 0) {
      return registry;
    }

    const defaults = [
      {
        modelKey: "chronos",
        displayName: "Chronos Forecast",
        role: "forecast",
        marketScope: "stocks",
        isEnabled: true,
        weight: 0.25,
        status: "healthy",
        version: "chronos-tiny",
        checkpoint: DEFAULT_SETTINGS.activeCheckpoint,
        metadata: JSON.stringify({ description: "Price forecasting head" }),
      },
      {
        modelKey: "kronos",
        displayName: "Kronos Candlestick",
        role: "candlestick",
        marketScope: "stocks",
        isEnabled: true,
        weight: 0.20,
        status: "healthy",
        version: "kronos-kline",
        checkpoint: DEFAULT_SETTINGS.activeCheckpoint,
        metadata: JSON.stringify({ description: "Candlestick/regime head" }),
      },
      {
        modelKey: "stockai",
        displayName: "StockAI Specialist",
        role: "specialist",
        marketScope: "stocks",
        isEnabled: true,
        weight: 0.30,
        status: "healthy",
        version: "stockai-v1",
        checkpoint: DEFAULT_SETTINGS.activeCheckpoint,
        metadata: JSON.stringify({ description: "Stock-specific specialist head" }),
      },
      {
        modelKey: "finrl",
        displayName: "FinRL Policy",
        role: "policy",
        marketScope: "stocks",
        isEnabled: true,
        weight: 0.15,
        status: "healthy",
        version: "finrl-policy",
        checkpoint: DEFAULT_SETTINGS.activeCheckpoint,
        metadata: JSON.stringify({ description: "Policy/risk scoring head" }),
      },
      {
        modelKey: "technical",
        displayName: "Technical Guard",
        role: "guard",
        marketScope: "stocks",
        isEnabled: true,
        weight: DEFAULT_SETTINGS.technicalWeight,
        status: "healthy",
        version: "technical-guard-v1",
        checkpoint: DEFAULT_SETTINGS.activeCheckpoint,
        metadata: JSON.stringify({ description: "Existing technical analysis guard" }),
      },
    ] satisfies InsertMlModelRegistryEntry[];

    const created: MlModelRegistryEntry[] = [];
    for (const model of defaults) {
      created.push(await storage.upsertMlModelRegistry(model));
    }
    return created;
  }

  async getModelHealth(): Promise<EnsembleModelHealth[]> {
    const registry = await this.getModelRegistry();
    return registry.map((entry) => ({
      modelKey: entry.modelKey,
      displayName: entry.displayName,
      status: formatModelStatus(entry.status),
      version: entry.version || null,
      checkpoint: entry.checkpoint || null,
      lastTrainedAt: entry.lastTrainedAt?.toISOString() || null,
      weight: entry.weight,
      role: entry.role,
    }));
  }

  async refreshModelStatus(): Promise<void> {
    try {
      const response = await fetchJson<SidecarPredictResponse>(`${SIDE_CAR_URL}/health`, { method: "GET" }, 1500);
      const healthy = response.modelHealth.filter((item) => item.status === "healthy").length;
      const degraded = response.modelHealth.filter((item) => item.status === "degraded").length;
      const offline = response.modelHealth.filter((item) => item.status === "offline").length;

      await storage.upsertSystemStatus({
        component: "ml_ensemble",
        status: offline > 0 ? "degraded" : "healthy",
        lastCheck: new Date(),
        lastSuccess: new Date(),
        errorMessage: null,
        metadata: JSON.stringify({
          sidecarUrl: SIDE_CAR_URL,
          healthy,
          degraded,
          offline,
          checkpoint: response.checkpoint,
        }),
      });
    } catch (error) {
      await storage.upsertSystemStatus({
        component: "ml_ensemble",
        status: "error",
        lastCheck: new Date(),
        lastSuccess: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: JSON.stringify({ sidecarUrl: SIDE_CAR_URL, offline: true }),
      });
    }
  }

  async analyzeCandles(input: EnsembleAnalysisInput): Promise<EnsembleMergeResult> {
    const technicalSignal = generateUnifiedSignal(input.candles);
    const settings = await this.loadSettings();
    const modelRegistry = await this.getModelRegistry();
    const profile = input.symbolProfile ?? await storage.getMonitoredSymbols().then((items) => items.find((item) => item.symbol === input.symbol) || null);
    const currentPrice = input.candles[input.candles.length - 1]?.close ?? technicalSignal.indicators.currentPrice ?? 0;
    const marketScope = inferMarketScope(input.symbol, profile);
    const isStockFocused = marketScope === "stocks";
    const stepsAhead = input.stepsAhead ?? 1;
    const fallbackTechnicalSummary = this.buildTechnicalSummary(
      input.symbol,
      marketScope,
      technicalSignal,
      settings,
      currentPrice,
      modelRegistry,
      isStockFocused,
    );

    if (!isStockFocused || input.candles.length < settings.minCandles) {
      const summary = {
        ...fallbackTechnicalSummary,
        marketScope,
        isStockFocused,
        fallbackUsed: true,
        abstainReason: input.candles.length < settings.minCandles
          ? `Insufficient candles (${input.candles.length} < ${settings.minCandles})`
          : "Stock-first ensemble disabled for this market class",
      };
      return {
        summary,
        technicalSignal,
        modelRegistry,
        sidecarResponse: null,
      };
    }

    const featureSnapshot = buildFeatureSnapshot(input.symbol, input.candles, technicalSignal, profile, settings);
    let sidecarResponse: SidecarPredictResponse | null = null;

    try {
      sidecarResponse = await fetchJson<SidecarPredictResponse>(`${SIDE_CAR_URL}/predict`, {
        method: "POST",
        body: JSON.stringify({
          symbol: input.symbol,
          timeframe: input.timeframe || "1min",
          stepsAhead,
          currentPrice,
          candles: featureSnapshot.candles,
          technicalSnapshot: featureSnapshot.technicalSignal,
          marketScope,
          symbolProfile: featureSnapshot.symbolProfile,
          activeCheckpoint: settings.activeCheckpoint,
          modelRegistry: modelRegistry.map((entry) => ({
            modelKey: entry.modelKey,
            displayName: entry.displayName,
            role: entry.role,
            marketScope: entry.marketScope,
            isEnabled: entry.isEnabled,
            weight: entry.weight,
            status: entry.status,
            version: entry.version,
            checkpoint: entry.checkpoint,
          })),
        }),
      });
    } catch (error) {
      const summary = {
        ...fallbackTechnicalSummary,
        marketScope,
        isStockFocused,
        fallbackUsed: true,
        abstainReason: error instanceof Error ? error.message : "ML sidecar unavailable",
      };
      return {
        summary,
        technicalSignal,
        modelRegistry,
        sidecarResponse: null,
      };
    }

    const modelOutputs = sidecarResponse.modelOutputs ?? [];
    const merged = mergeModelContributions(
      currentPrice,
      technicalSignal,
      modelOutputs,
      modelRegistry,
      settings,
    );

    const finalDecision = merged.abstainReason ? "HOLD" : decisionFromDirection(merged.direction);
    const summary: EnsembleSummary = {
      symbol: input.symbol,
      marketScope,
      isStockFocused,
      decision: finalDecision,
      direction: merged.direction,
      confidence: merged.confidence,
      trustScore: merged.trustScore,
      consensusScore: merged.consensusScore,
      predictedPrice: merged.predictedPrice,
      forecastLower: merged.forecastLower,
      forecastUpper: merged.forecastUpper,
      currentPrice,
      modelType: "local_stock_ensemble_v1",
      checkpoint: sidecarResponse.checkpoint || settings.activeCheckpoint,
      generatedAt: new Date().toISOString(),
      fallbackUsed: !!sidecarResponse.fallbackUsed,
      abstainReason: merged.abstainReason || sidecarResponse.sidecarConsensus.abstainReason || null,
      technicalSignal: {
        signal: technicalSignal.decision,
        strength: technicalSignal.confidence,
        reasons: technicalSignal.reasons.map((reason) => reason.description),
      },
      modelContributions: [
        buildTechnicalContribution(technicalSignal, currentPrice, settings.technicalWeight),
        ...modelOutputs
          .filter((output) => modelRegistry.find((entry) => entry.modelKey === output.modelKey)?.isEnabled !== false)
          .map((output) => {
            const registry = modelRegistry.find((entry) => entry.modelKey === output.modelKey);
            const weight = normalizeWeight(registry?.weight ?? output.weightHint, 0.1);
            return {
              modelKey: output.modelKey,
              displayName: output.displayName,
              role: output.role,
              direction: output.direction,
              confidence: output.confidence,
              weight,
              weightedScore: scoreDirection(output.direction) * (output.confidence / 100) * weight,
              forecastPrice: output.forecastPrice,
              forecastLower: output.forecastLower,
              forecastUpper: output.forecastUpper,
              rationale: output.rationale,
              status: formatModelStatus(output.status),
            } satisfies EnsembleModelContribution;
          }),
      ],
      modelHealth: sidecarResponse.modelHealth?.length > 0
        ? sidecarResponse.modelHealth
        : modelRegistry.map((entry) => ({
            modelKey: entry.modelKey,
            displayName: entry.displayName,
            status: formatModelStatus(entry.status),
            version: entry.version || null,
            checkpoint: entry.checkpoint || null,
            lastTrainedAt: entry.lastTrainedAt?.toISOString() || null,
            weight: entry.weight,
            role: entry.role,
          })),
    };

    const auditId = input.persist === false
      ? undefined
      : await this.recordAudit({
          symbol: input.symbol,
          timeframe: input.timeframe || "1min",
          marketScope,
          predictionType: input.source || "prediction",
          currentPrice,
          predictedPrice: summary.predictedPrice,
          predictedDirection: summary.direction,
          confidence: summary.confidence,
          trustScore: summary.trustScore,
          consensusScore: summary.consensusScore,
          forecastLower: summary.forecastLower,
          forecastUpper: summary.forecastUpper,
          checkpoint: summary.checkpoint,
          modelBreakdown: JSON.stringify(summary.modelContributions),
          featureSnapshot: JSON.stringify(featureSnapshot),
          abstainReason: summary.abstainReason || null,
          baselineDecision: technicalSignal.decision,
          ensembleDecision: summary.decision,
          metadata: JSON.stringify({
            marketScope,
            fallbackUsed: summary.fallbackUsed,
            modelHealth: summary.modelHealth,
            sidecarConsensus: sidecarResponse.sidecarConsensus,
          }),
        });

    summary.modelContributions = summary.modelContributions.map((item) => item);
    return {
      summary: {
        ...summary,
      },
      technicalSignal,
      modelRegistry,
      sidecarResponse,
      auditId,
    };
  }

  async analyzeBatch(inputs: EnsembleAnalysisInput[]): Promise<EnsembleMergeResult[]> {
    const results: EnsembleMergeResult[] = [];
    for (const input of inputs) {
      results.push(await this.analyzeCandles(input));
    }
    return results;
  }

  async buildPredictionRecord(input: EnsembleAnalysisInput): Promise<InsertPrediction> {
    const result = await this.analyzeCandles(input);
    const summary = result.summary;
    const minutesAhead = input.minutesAhead ?? input.stepsAhead ?? 1;
    return {
      symbol: input.symbol,
      predictionTimestamp: new Date(),
      targetTimestamp: new Date(Date.now() + 60_000 * minutesAhead),
      predictedPrice: summary.predictedPrice,
      predictedDirection: summary.direction,
      modelType: summary.modelType,
      confidence: summary.confidence,
      trustScore: summary.trustScore,
      consensusScore: summary.consensusScore,
      forecastLower: summary.forecastLower,
      forecastUpper: summary.forecastUpper,
      ensembleBreakdown: JSON.stringify(summary.modelContributions),
      ensembleAuditId: result.auditId ?? null,
      timeframe: input.timeframe || "1min",
    };
  }

  async buildSuggestionRecord(input: EnsembleAnalysisInput): Promise<InsertAiSuggestion> {
    const result = await this.analyzeCandles(input);
    const summary = result.summary;
    const technicalSignal = result.technicalSignal;
    const buyTarget = summary.direction === "UP" ? summary.predictedPrice : currentFallbackPrice(summary);
    const sellTarget = summary.direction === "DOWN" ? summary.predictedPrice : currentFallbackPrice(summary);
    const reasons = [
      ...technicalSignal.reasons.map((reason) => ({
        indicator: reason.indicator,
        signal: reason.signal,
        description: reason.description,
        weight: reason.weight,
      })),
      ...summary.modelContributions.map((contribution) => ({
        indicator: contribution.displayName,
        signal: contribution.direction === "UP" ? "bullish" : contribution.direction === "DOWN" ? "bearish" : "neutral",
        description: `${contribution.displayName}: ${contribution.rationale}`,
        weight: contribution.weight,
      })),
    ];

    const indicators = technicalSignal.indicators;
    return {
      symbol: input.symbol,
      generatedAt: new Date(),
      decision: summary.decision,
      confidence: summary.confidence,
      trustScore: summary.trustScore,
      consensusScore: summary.consensusScore,
      buyTarget,
      sellTarget,
      forecastLower: summary.forecastLower,
      forecastUpper: summary.forecastUpper,
      currentPrice: summary.currentPrice,
      reasoning: JSON.stringify(reasons),
      indicators: JSON.stringify(indicators),
      ensembleBreakdown: JSON.stringify(summary.modelContributions),
      ensembleAuditId: result.auditId ?? null,
      isEvaluated: false,
      entryPrice: summary.decision === "BUY" || summary.decision === "SELL" ? summary.predictedPrice : null,
      stopLoss: summary.decision === "BUY" ? summary.forecastLower : summary.decision === "SELL" ? summary.forecastUpper : null,
      takeProfit1: summary.decision === "BUY" ? summary.forecastUpper : summary.decision === "SELL" ? summary.forecastLower : null,
      takeProfit2: summary.decision === "BUY" ? summary.forecastUpper : summary.decision === "SELL" ? summary.forecastLower : null,
      takeProfit3: summary.decision === "BUY" ? summary.forecastUpper : summary.decision === "SELL" ? summary.forecastLower : null,
      riskRewardRatio: summary.decision === "HOLD" ? null : Math.max(1, summary.confidence / 25),
      supportLevel: summary.forecastLower,
      resistanceLevel: summary.forecastUpper,
      signalType: summary.decision === "HOLD" ? "pending" : "immediate",
      validUntil: new Date(Date.now() + 60 * 60 * 1000),
      tradePlan: JSON.stringify({
        checkpoint: summary.checkpoint,
        trustScore: summary.trustScore,
        consensusScore: summary.consensusScore,
        modelContributions: summary.modelContributions,
      }),
    };
  }

  async recordAudit(audit: InsertMlModelAudit): Promise<number> {
    const inserted = await storage.insertMlModelAudit(audit);
    return inserted.id;
  }

  async promoteCheckpointIfImproved(
    symbol: string,
    checkpoint: string,
    benchmark: Record<string, unknown>,
  ): Promise<void> {
    const registry = await this.getModelRegistry();
    const nextMetadata = JSON.stringify(benchmark);
    await Promise.all(registry.map((entry) => storage.updateMlModelRegistry(entry.modelKey, {
      checkpoint,
      lastBenchmarkedAt: new Date(),
      metadata: nextMetadata,
    })));
    const nextSettings = await this.saveSettings({ activeCheckpoint: checkpoint });
    await storage.upsertSystemStatus({
      component: "ml_ensemble",
      status: "healthy",
      lastCheck: new Date(),
      lastSuccess: new Date(),
      errorMessage: null,
      metadata: JSON.stringify({
        checkpoint,
        benchmark,
        settings: nextSettings,
      }),
    });
  }
}

function currentFallbackPrice(summary: EnsembleSummary): number | null {
  if (summary.forecastLower && summary.forecastUpper) {
    return Math.round(((summary.forecastLower + summary.forecastUpper) / 2) * 100) / 100;
  }
  return summary.currentPrice;
}

export const ensembleOrchestrator = new EnsembleOrchestrator();
