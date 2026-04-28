#!/usr/bin/env python3
"""Local stock ensemble sidecar.

This service keeps the ensemble fully local and dependency-light. It uses
statistical candle features to emulate the Chronos, Kronos, StockAI, and FinRL
roles with explicit health and abstain outputs.
"""

from __future__ import annotations

import json
import math
import os
import statistics
import threading
import time
from collections import deque
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Iterable, List, Optional


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_mean(values: Iterable[float], default: float = 0.0) -> float:
    items = [v for v in values if v is not None]
    return statistics.fmean(items) if items else default


def safe_stdev(values: Iterable[float], default: float = 0.0) -> float:
    items = [v for v in values if v is not None]
    if len(items) < 2:
        return default
    try:
        return statistics.pstdev(items)
    except statistics.StatisticsError:
        return default


def parse_timestamp(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            from datetime import datetime

            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0
    return 0.0


def sort_candles(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(candles, key=lambda c: parse_timestamp(c.get("timestamp")))


def closes(candles: List[Dict[str, Any]]) -> List[float]:
    return [to_float(c.get("close")) for c in candles]


def highs(candles: List[Dict[str, Any]]) -> List[float]:
    return [to_float(c.get("high")) for c in candles]


def lows(candles: List[Dict[str, Any]]) -> List[float]:
    return [to_float(c.get("low")) for c in candles]


def volumes(candles: List[Dict[str, Any]]) -> List[float]:
    return [to_float(c.get("volume")) for c in candles]


def ema(values: List[float], period: int) -> float:
    if not values:
        return 0.0
    period = max(1, min(period, len(values)))
    multiplier = 2.0 / (period + 1.0)
    result = values[0]
    for value in values[1:]:
        result = (value * multiplier) + (result * (1 - multiplier))
    return result


def rsi(values: List[float], period: int = 14) -> float:
    if len(values) < 2:
        return 50.0

    period = max(1, min(period, len(values) - 1))
    gains = 0.0
    losses = 0.0

    window = values[-(period + 1):]
    for prev, curr in zip(window, window[1:]):
        diff = curr - prev
        if diff >= 0:
            gains += diff
        else:
            losses -= diff

    if losses == 0:
        return 100.0 if gains > 0 else 50.0

    rs = gains / losses
    return 100.0 - (100.0 / (1.0 + rs))


def atr(candles: List[Dict[str, Any]], period: int = 14) -> float:
    if len(candles) < 2:
        return 0.0

    trs: List[float] = []
    window = candles[-(period + 1):]
    for prev, curr in zip(window, window[1:]):
        high = to_float(curr.get("high"))
        low = to_float(curr.get("low"))
        prev_close = to_float(prev.get("close"))
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)

    return safe_mean(trs, default=0.0)


def slope(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0

    xs = list(range(len(values)))
    x_mean = safe_mean(xs, 0.0)
    y_mean = safe_mean(values, 0.0)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, values))
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    return numerator / denominator


def returns(values: List[float]) -> List[float]:
    result: List[float] = []
    for prev, curr in zip(values, values[1:]):
        if prev == 0:
            continue
        result.append((curr - prev) / prev)
    return result


def candles_are_bullish(candle: Dict[str, Any]) -> bool:
    return to_float(candle.get("close")) >= to_float(candle.get("open"))


def candles_are_bearish(candle: Dict[str, Any]) -> bool:
    return to_float(candle.get("close")) < to_float(candle.get("open"))


def detect_patterns(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(candles) < 2:
        return []

    patterns: List[Dict[str, Any]] = []
    prev = candles[-2]
    curr = candles[-1]
    open_ = to_float(curr.get("open"))
    close = to_float(curr.get("close"))
    high = to_float(curr.get("high"))
    low = to_float(curr.get("low"))
    body = abs(close - open_)
    range_ = max(high - low, 1e-9)
    upper_wick = high - max(open_, close)
    lower_wick = min(open_, close) - low

    if candles_are_bearish(prev) and candles_are_bullish(curr) and close > to_float(prev.get("open")):
        patterns.append({
            "name": "Bullish Engulfing",
            "type": "bullish",
            "strength": clamp((body / range_) * 100, 20, 100),
            "description": "Bullish reversal after a bearish candle",
        })
    if candles_are_bullish(prev) and candles_are_bearish(curr) and close < to_float(prev.get("open")):
        patterns.append({
            "name": "Bearish Engulfing",
            "type": "bearish",
            "strength": clamp((body / range_) * 100, 20, 100),
            "description": "Bearish reversal after a bullish candle",
        })
    if body / range_ <= 0.15:
        patterns.append({
            "name": "Doji",
            "type": "neutral",
            "strength": clamp(100 - (body / range_) * 400, 20, 85),
            "description": "Indecision with a small candle body",
        })
    if lower_wick > body * 2 and upper_wick <= body:
        patterns.append({
            "name": "Hammer",
            "type": "bullish",
            "strength": clamp((lower_wick / range_) * 100, 25, 95),
            "description": "Bullish rejection from lower prices",
        })
    if upper_wick > body * 2 and lower_wick <= body:
        patterns.append({
            "name": "Shooting Star",
            "type": "bearish",
            "strength": clamp((upper_wick / range_) * 100, 25, 95),
            "description": "Bearish rejection from higher prices",
        })

    return patterns


def regime_score(candles: List[Dict[str, Any]]) -> float:
    if len(candles) < 3:
        return 0.0

    closes_ = closes(candles)
    ema_fast = ema(closes_[-12:], min(12, len(closes_)))
    ema_slow = ema(closes_[-26:], min(26, len(closes_)))
    rsi_value = rsi(closes_)
    recent_returns = returns(closes_[-8:])
    momentum = safe_mean(recent_returns, 0.0)

    slope_score = slope(closes_[-20:]) / max(closes_[-1], 1e-9)
    ema_gap = (ema_fast - ema_slow) / max(closes_[-1], 1e-9)
    rsi_score = (rsi_value - 50.0) / 50.0
    momentum_score = momentum * 10.0
    return (slope_score * 35.0) + (ema_gap * 100.0) + (rsi_score * 12.0) + (momentum_score * 18.0)


def forecast_band(current_price: float, volatility: float, steps_ahead: int, factor: float = 1.0) -> Dict[str, float]:
    band = max(current_price * 0.0025, volatility * current_price * factor * math.sqrt(max(1, steps_ahead)))
    return {
        "lower": max(0.0, current_price - band),
        "upper": current_price + band,
    }


def head_output(
    model_key: str,
    display_name: str,
    role: str,
    direction: str,
    confidence: float,
    forecast_price: float,
    current_price: float,
    volatility: float,
    rationale: str,
    weight_hint: float,
    status: str = "healthy",
) -> Dict[str, Any]:
    band = forecast_band(current_price, volatility, 1, 1.0)
    return {
        "modelKey": model_key,
        "displayName": display_name,
        "role": role,
        "direction": direction,
        "confidence": round(clamp(confidence, 5.0, 99.0), 1),
        "forecastPrice": round(forecast_price, 2),
        "forecastLower": round(min(band["lower"], forecast_price), 2),
        "forecastUpper": round(max(band["upper"], forecast_price), 2),
        "rationale": rationale,
        "status": status,
        "weightHint": weight_hint,
    }


def chronos_head(candles: List[Dict[str, Any]], steps_ahead: int) -> Dict[str, Any]:
    closes_ = closes(candles)
    current = closes_[-1]
    recent = closes_[-24:] if len(closes_) >= 24 else closes_
    rets = returns(recent)
    trend = slope(recent)
    vol = safe_stdev(rets, 0.0)
    momentum = safe_mean(rets[-4:], 0.0)
    score = ((trend / max(current, 1e-9)) * 120.0) + (momentum * 180.0)
    direction = "UP" if score > 0.12 else "DOWN" if score < -0.12 else "NEUTRAL"
    confidence = 48.0 + min(40.0, abs(score) * 90.0) - (vol * 100.0)
    forecast = current * (1.0 + (score * 0.015 * max(1, steps_ahead)))
    rationale = "Trend extrapolation with volatility-aware bands"
    return head_output(
        "chronos",
        "Chronos Forecast",
        "forecast",
        direction,
        confidence,
        forecast,
        current,
        max(vol, 0.0025),
        rationale,
        0.25,
    )


def kronos_head(candles: List[Dict[str, Any]], steps_ahead: int) -> Dict[str, Any]:
    closes_ = closes(candles)
    current = closes_[-1]
    patterns = detect_patterns(candles)
    regime = regime_score(candles)
    pattern_score = 0.0
    reasons: List[str] = []

    for pattern in patterns:
        strength = to_float(pattern.get("strength")) / 100.0
        if pattern.get("type") == "bullish":
            pattern_score += strength * 1.2
        elif pattern.get("type") == "bearish":
            pattern_score -= strength * 1.2
        reasons.append(pattern.get("name", "Pattern"))

    score = pattern_score + (regime / 100.0)
    direction = "UP" if score > 0.14 else "DOWN" if score < -0.14 else "NEUTRAL"
    confidence = 42.0 + min(42.0, abs(score) * 120.0)
    volatility = safe_stdev(returns(closes_[-14:]), 0.0)
    forecast = current * (1.0 + (score * 0.02 * max(1, steps_ahead)))
    rationale = "; ".join(reasons) if reasons else "Candlestick regime is balanced"
    if not patterns:
        rationale = "Candlestick regime is balanced"
    return head_output(
        "kronos",
        "Kronos Candlestick",
        "candlestick",
        direction,
        confidence,
        forecast,
        current,
        max(volatility, 0.0025),
        rationale,
        0.20,
    )


def stockai_head(candles: List[Dict[str, Any]], steps_ahead: int) -> Dict[str, Any]:
    closes_ = closes(candles)
    vols = volumes(candles)
    current = closes_[-1]
    regime = regime_score(candles)
    recent_vol = safe_mean(vols[-10:], 0.0)
    long_vol = safe_mean(vols[-30:], recent_vol or 1.0)
    volume_trend = (recent_vol / max(long_vol, 1.0)) - 1.0 if long_vol else 0.0
    support = min(closes_[-20:]) if len(closes_) >= 20 else min(closes_)
    resistance = max(closes_[-20:]) if len(closes_) >= 20 else max(closes_)
    support_gap = (current - support) / max(current, 1e-9)
    resistance_gap = (resistance - current) / max(current, 1e-9)
    momentum = safe_mean(returns(closes_[-10:]), 0.0)
    score = (regime / 110.0) + (momentum * 22.0) + (volume_trend * 0.8)
    if support_gap < 0.012:
        score += 0.18
    if resistance_gap < 0.012:
        score -= 0.18
    direction = "UP" if score > 0.16 else "DOWN" if score < -0.16 else "NEUTRAL"
    confidence = 46.0 + min(40.0, abs(score) * 100.0) + min(8.0, abs(volume_trend) * 20.0)
    forecast = current * (1.0 + (score * 0.0175 * max(1, steps_ahead)))
    rationale = "Support/resistance and volume regime for stock-specific bias"
    return head_output(
        "stockai",
        "StockAI Specialist",
        "specialist",
        direction,
        confidence,
        forecast,
        current,
        max(safe_stdev(returns(closes_[-14:]), 0.0), 0.0025),
        rationale,
        0.30,
    )


def finrl_head(candles: List[Dict[str, Any]], steps_ahead: int) -> Dict[str, Any]:
    closes_ = closes(candles)
    current = closes_[-1]
    rets = returns(closes_[-20:])
    vol = safe_stdev(rets, 0.0)
    trend = slope(closes_[-18:]) / max(current, 1e-9)
    reward = trend * 100.0
    risk = max(vol * 120.0, 1.0)
    reward_ratio = reward / risk
    if reward_ratio > 0.45:
        direction = "UP"
    elif reward_ratio < -0.45:
        direction = "DOWN"
    else:
        direction = "NEUTRAL"
    confidence = 38.0 + min(42.0, abs(reward_ratio) * 55.0) - min(10.0, vol * 120.0)
    if direction == "NEUTRAL":
        confidence = min(confidence, 58.0)
    forecast = current * (1.0 + (reward_ratio * 0.01 * max(1, steps_ahead)))
    rationale = "Risk-adjusted policy scorer prefers abstain when reward/risk weak"
    return head_output(
        "finrl",
        "FinRL Policy",
        "policy",
        direction,
        confidence,
        forecast,
        current,
        max(vol, 0.0025),
        rationale,
        0.15,
    )


def technical_health_entry() -> Dict[str, Any]:
    return {
        "modelKey": "technical",
        "displayName": "Technical Guard",
        "status": "healthy",
        "version": "technical-guard-v1",
        "checkpoint": os.getenv("ML_ACTIVE_CHECKPOINT", "stock-ensemble-v1"),
        "lastTrainedAt": STATE["lastTrainedAt"],
        "weight": 0.10,
        "role": "guard",
    }


def default_model_health() -> List[Dict[str, Any]]:
    models = [
        ("chronos", "Chronos Forecast", "forecast", 0.25),
        ("kronos", "Kronos Candlestick", "candlestick", 0.20),
        ("stockai", "StockAI Specialist", "specialist", 0.30),
        ("finrl", "FinRL Policy", "policy", 0.15),
        ("technical", "Technical Guard", "guard", 0.10),
    ]
    health = []
    for model_key, display_name, role, weight in models:
        health.append({
            "modelKey": model_key,
            "displayName": display_name,
            "status": "healthy" if not STATE["training"] else "training",
            "version": STATE["version"],
            "checkpoint": STATE["checkpoint"],
            "lastTrainedAt": STATE["lastTrainedAt"],
            "weight": weight,
            "role": role,
        })
    return health


STATE = {
    "version": "local-stock-ensemble-v1",
    "checkpoint": os.environ.get("ML_ACTIVE_CHECKPOINT", "stock-ensemble-v1"),
    "lastTrainedAt": None,
    "lastReloadAt": time.time(),
    "training": False,
    "lock": threading.Lock(),
}


def build_sidecar_consensus(model_outputs: List[Dict[str, Any]], current_price: float) -> Dict[str, Any]:
    if not model_outputs:
        return {
            "direction": "NEUTRAL",
            "confidence": 0.0,
            "trustScore": 0.0,
            "consensusScore": 0.0,
            "forecastPrice": current_price,
            "forecastLower": current_price,
            "forecastUpper": current_price,
            "abstainReason": "No enabled model outputs were available",
        }

    weights = {
        "chronos": 0.25,
        "kronos": 0.20,
        "stockai": 0.30,
        "finrl": 0.15,
        "technical": 0.10,
    }
    score = 0.0
    total_weight = 0.0
    confidence = 0.0
    forecast_price = 0.0
    forecast_lower = 0.0
    forecast_upper = 0.0
    active = 0
    neutral_weight = 0.0
    healthy = 0
    degraded = 0
    offline = 0

    for output in model_outputs:
        model_key = output.get("modelKey")
        weight = to_float(output.get("weightHint"), weights.get(model_key, 0.1))
        direction = output.get("direction", "NEUTRAL")
        conf = clamp(to_float(output.get("confidence"), 0.0), 0.0, 100.0)
        forecast = to_float(output.get("forecastPrice"), current_price)
        lower = to_float(output.get("forecastLower"), min(current_price, forecast))
        upper = to_float(output.get("forecastUpper"), max(current_price, forecast))
        status = str(output.get("status", "degraded"))

        if status == "healthy":
            healthy += 1
        elif status == "offline":
            offline += 1
        else:
            degraded += 1

        if direction == "NEUTRAL":
            neutral_weight += weight

        total_weight += weight
        active += 1
        confidence += (conf / 100.0) * weight
        forecast_price += forecast * weight
        forecast_lower += lower * weight
        forecast_upper += upper * weight
        score += (1 if direction == "UP" else -1 if direction == "DOWN" else 0) * weight

    total_weight = total_weight or 1.0
    raw_direction = "UP" if score > 0.02 else "DOWN" if score < -0.02 else "NEUTRAL"
    direction_weight = sum(
        to_float(output.get("weightHint"), weights.get(output.get("modelKey"), 0.1))
        for output in model_outputs
        if output.get("direction") == raw_direction and raw_direction != "NEUTRAL"
    )
    consensus = clamp((direction_weight / total_weight) * 100.0, 0.0, 100.0)
    spread = abs(forecast_upper - forecast_lower) / max(forecast_upper, forecast_lower, 1e-9)
    trust = clamp((consensus * 0.45) + (confidence / total_weight * 100.0 * 0.35) + (100.0 - spread * 100.0 * 3.0) * 0.20, 0.0, 100.0)
    abstain_reasons: List[str] = []
    if raw_direction == "NEUTRAL":
        abstain_reasons.append("Consensus is neutral")
    if spread > 0.05:
        abstain_reasons.append("Forecast spread is too wide")
    if offline:
        abstain_reasons.append(f"{offline} model(s) offline")
    if degraded and not healthy:
        abstain_reasons.append("Model health is degraded")

    return {
        "direction": raw_direction,
        "confidence": round(clamp(confidence / total_weight * 100.0, 0.0, 100.0), 1),
        "trustScore": round(trust, 1),
        "consensusScore": round(consensus, 1),
        "forecastPrice": round(forecast_price / total_weight, 2),
        "forecastLower": round(forecast_lower / total_weight, 2),
        "forecastUpper": round(forecast_upper / total_weight, 2),
        "abstainReason": "; ".join(abstain_reasons) if abstain_reasons else None,
        "health": {
            "healthy": healthy,
            "degraded": degraded,
            "offline": offline,
            "active": active,
        },
    }


def predict_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    symbol = str(payload.get("symbol") or "UNKNOWN")
    market_scope = str(payload.get("marketScope") or "stocks")
    checkpoints = payload.get("activeCheckpoint")
    candles = sort_candles([c for c in payload.get("candles", []) if isinstance(c, dict)])
    if len(candles) < 5:
        current_price = to_float(payload.get("currentPrice"), 0.0)
        return {
            "symbol": symbol,
            "marketScope": market_scope,
            "checkpoint": checkpoints,
            "isStockFocused": market_scope == "stocks",
            "fallbackUsed": True,
            "currentPrice": current_price,
            "modelOutputs": [],
            "sidecarConsensus": build_sidecar_consensus([], current_price),
            "modelHealth": default_model_health(),
            "rawFeatureSummary": {"reason": "Insufficient candles"},
        }

    steps_ahead = max(1, to_int(payload.get("stepsAhead"), 1))
    current_price = to_float(payload.get("currentPrice"), to_float(candles[-1].get("close"), 0.0))
    rets = returns(closes(candles))
    volatility = max(safe_stdev(rets, 0.0), 0.0025)

    registry = [entry for entry in payload.get("modelRegistry", []) if isinstance(entry, dict)]
    enabled_registry = [entry for entry in registry if entry.get("isEnabled", True)]

    outputs: List[Dict[str, Any]] = []
    for entry in enabled_registry:
        model_key = str(entry.get("modelKey"))
        if model_key == "technical":
            continue

        if model_key == "chronos":
            output = chronos_head(candles, steps_ahead)
        elif model_key == "kronos":
            output = kronos_head(candles, steps_ahead)
        elif model_key == "stockai":
            output = stockai_head(candles, steps_ahead)
        elif model_key == "finrl":
            output = finrl_head(candles, steps_ahead)
        else:
            direction = "UP" if regime_score(candles) > 0.15 else "DOWN" if regime_score(candles) < -0.15 else "NEUTRAL"
            output = head_output(
                model_key or "unknown",
                str(entry.get("displayName") or model_key or "Model"),
                str(entry.get("role") or "model"),
                direction,
                40.0,
                current_price * (1.0 + (0.01 if direction == "UP" else -0.01 if direction == "DOWN" else 0.0)),
                current_price,
                volatility,
                "Fallback statistical head",
                to_float(entry.get("weight"), 0.1),
                "degraded",
            )

        output["status"] = "healthy" if str(entry.get("status", "healthy")) == "healthy" else str(entry.get("status", "degraded"))
        output["weightHint"] = to_float(entry.get("weight"), output.get("weightHint", 0.1))
        output["displayName"] = str(entry.get("displayName") or output.get("displayName"))
        output["role"] = str(entry.get("role") or output.get("role"))
        outputs.append(output)

    if not outputs:
        outputs = [chronos_head(candles, steps_ahead), kronos_head(candles, steps_ahead)]

    consensus = build_sidecar_consensus(outputs, current_price)
    health = default_model_health()
    health_map = {item["modelKey"]: item for item in health}
    for entry in enabled_registry:
        model_key = str(entry.get("modelKey"))
        if model_key in health_map:
            health_map[model_key]["status"] = str(entry.get("status", "healthy"))
            health_map[model_key]["version"] = str(entry.get("version") or STATE["version"])
            health_map[model_key]["checkpoint"] = str(entry.get("checkpoint") or STATE["checkpoint"])
            health_map[model_key]["weight"] = to_float(entry.get("weight"), health_map[model_key].get("weight", 0.1))
            health_map[model_key]["role"] = str(entry.get("role") or health_map[model_key].get("role"))

    return {
        "symbol": symbol,
        "marketScope": market_scope,
        "checkpoint": str(checkpoints) if checkpoints else STATE["checkpoint"],
        "isStockFocused": market_scope == "stocks",
        "fallbackUsed": False,
        "currentPrice": current_price,
        "modelOutputs": outputs,
        "sidecarConsensus": consensus,
        "modelHealth": list(health_map.values()),
        "rawFeatureSummary": {
            "candles": len(candles),
            "volatility": round(volatility, 6),
            "trendScore": round(regime_score(candles), 4),
        },
    }


def batch_predict_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    items = payload.get("items") or payload.get("requests") or []
    return {
        "results": [predict_payload(item if isinstance(item, dict) else {}) for item in items],
    }


def health_payload() -> Dict[str, Any]:
    uptime_seconds = int(time.time() - STATE["lastReloadAt"])
    return {
        "status": "healthy" if not STATE["training"] else "training",
        "checkpoint": STATE["checkpoint"],
        "version": STATE["version"],
        "lastReloadAt": STATE["lastReloadAt"],
        "lastTrainedAt": STATE["lastTrainedAt"],
        "uptimeSeconds": uptime_seconds,
        "training": STATE["training"],
        "modelHealth": default_model_health(),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "TradeViewMLSidecar/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[sidecar] {self.address_string()} - {fmt % args}")

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._send_json(health_payload())
            return
        if path == "/":
            self._send_json({
                "name": "TradeView local stock ensemble sidecar",
                "status": "ok",
                "routes": ["/health", "/predict", "/predict/batch", "/reload", "/train"],
            })
            return
        self._send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        payload = self._read_json()

        if path == "/predict":
            self._send_json(predict_payload(payload))
            return

        if path == "/predict/batch":
            self._send_json(batch_predict_payload(payload))
            return

        if path == "/reload":
            with STATE["lock"]:
                STATE["lastReloadAt"] = time.time()
                STATE["training"] = False
            self._send_json(health_payload())
            return

        if path == "/train":
            with STATE["lock"]:
                STATE["training"] = True
                checkpoint = payload.get("checkpoint")
                if isinstance(checkpoint, str) and checkpoint:
                    STATE["checkpoint"] = checkpoint
                STATE["version"] = str(payload.get("version") or STATE["version"])
                STATE["lastTrainedAt"] = time.time()
                STATE["training"] = False
            self._send_json({
                "status": "trained",
                "checkpoint": STATE["checkpoint"],
                "version": STATE["version"],
                "lastTrainedAt": STATE["lastTrainedAt"],
                "benchmark": payload.get("benchmark"),
            })
            return

        self._send_json({"error": "Not found"}, status=404)


def main() -> None:
    host = os.environ.get("ML_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("ML_SIDECAR_PORT", os.environ.get("PORT", "8001")))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[sidecar] listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
