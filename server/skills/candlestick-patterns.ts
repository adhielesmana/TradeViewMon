/**
 * Candlestick Patterns Skill — Hardcoded Trading Knowledge Base
 *
 * Sources: BullishBears.com & Strike.money candlestick pattern guides
 * Integrated into Trady's AI analysis pipeline for pattern recognition
 * and trade signal generation.
 */

export type PatternType = "bullish" | "bearish" | "reversal" | "continuation" | "indecision";
export type PatternReliability = "high" | "moderate" | "low";

export interface CandlestickPattern {
  id: string;
  name: string;
  type: PatternType;
  candles: number; // 1, 2, or 3 candle pattern
  description: string;
  formation: string;
  psychology: string;
  signal: "buy" | "sell" | "hold" | "wait";
  reliability: PatternReliability;
  confirmation: string;
  stopLossPlacement: string;
  priceTarget: string;
  bestTimeframes: string[];
  bestMarketConditions: string;
}

export const CANDLESTICK_PATTERNS: CandlestickPattern[] = [
  // ==================== SINGLE CANDLE PATTERNS ====================
  {
    id: "marubozu_bullish",
    name: "Bullish Marubozu",
    type: "bullish",
    candles: 1,
    description: "A long green body with no shadows. Opens at the low, closes at the high. Shows complete buyer dominance.",
    formation: "Opens at session low, closes at session high. Body ≥90% of total range. No or negligible wicks.",
    psychology: "Aggressive buying from open to close. Sellers had no control. Strong conviction from bulls.",
    signal: "buy",
    reliability: "high",
    confirmation: "Next candle sustains above close with volume > 150% of average.",
    stopLossPlacement: "Below the low of the Marubozu or 1× ATR(14) below entry.",
    priceTarget: "Recent swing high. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "Trending markets. Can signal reversal after downtrend or continuation in uptrend."
  },
  {
    id: "marubozu_bearish",
    name: "Bearish Marubozu",
    type: "bearish",
    candles: 1,
    description: "A long red body with no shadows. Opens at the high, closes at the low. Shows complete seller dominance.",
    formation: "Opens at session high, closes at session low. Body ≥90% of total range. No or negligible wicks.",
    psychology: "Aggressive selling from open to close. Buyers had no control. Strong bearish conviction.",
    signal: "sell",
    reliability: "high",
    confirmation: "Next candle sustains below close with continued selling pressure.",
    stopLossPlacement: "Above the high of the Marubozu or 1× ATR(14) above entry.",
    priceTarget: "Recent swing low. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "Trending markets. Can signal reversal after uptrend or continuation in downtrend."
  },
  {
    id: "doji",
    name: "Doji",
    type: "indecision",
    candles: 1,
    description: "Open and close are virtually the same. Shows market indecision and potential reversal after strong trends.",
    formation: "Open ≈ Close (≤10% of total range). Body is extremely small. Wicks can be long or short.",
    psychology: "Battle between buyers and sellers ends in a draw. Prior trend is losing momentum.",
    signal: "hold",
    reliability: "moderate",
    confirmation: "Strong close above the Doji high (bullish) or below the Doji low (bearish) on next candle.",
    stopLossPlacement: "Opposite side of the Doji range. Wider stops for Long-Legged Doji.",
    priceTarget: "Swing levels or 1.5–2R multiples. Trail under breakout structure.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After extended rallies or selloffs. More meaningful at support/resistance zones."
  },
  {
    id: "dragonfly_doji",
    name: "Dragonfly Doji",
    type: "bullish",
    candles: 1,
    description: "Long lower shadow, no upper shadow, open/close at the top. Strong bullish reversal signal at bottoms.",
    formation: "Long lower shadow (≥2× body). Open and close near session high (top 10%). Minimal upper wick.",
    psychology: "Sellers pushed price down but buyers absorbed all supply and recovered to close at highs.",
    signal: "buy",
    reliability: "high",
    confirmation: "Strong green candle closing above the Dragonfly high with volume expansion.",
    stopLossPlacement: "Below the shadow low or ATR(14) cushion beneath low.",
    priceTarget: "Last swing high. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "At the bottom of a downtrend or major support. After oversold conditions."
  },
  {
    id: "gravestone_doji",
    name: "Gravestone Doji",
    type: "bearish",
    candles: 1,
    description: "Long upper shadow, no lower shadow, open/close at the bottom. Bearish reversal at tops.",
    formation: "Long upper shadow (≥2× body). Open and close near session low (bottom 10%). Negligible lower wick.",
    psychology: "Buyers pushed price up but failed. Sellers regained control into the close.",
    signal: "sell",
    reliability: "high",
    confirmation: "Strong red candle closing below the Gravestone base with heavy selling volume.",
    stopLossPlacement: "Above the upper shadow high.",
    priceTarget: "Recent swing low, then 1.5–2R multiples. Trail above lower highs.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "At the top of an uptrend or resistance zones. After overbought conditions."
  },
  {
    id: "long_legged_doji",
    name: "Long-Legged Doji",
    type: "indecision",
    candles: 1,
    description: "Exceptionally long upper and lower shadows with tiny body. Extreme indecision and volatility.",
    formation: "Open ≈ Close (≤10% of range). Very long upper and lower shadows (≥2× body each).",
    psychology: "Both sides pushed aggressively but neither maintained control. Market balance is unstable.",
    signal: "wait",
    reliability: "low",
    confirmation: "Breakout above high or below low with volume in next 1-2 candles.",
    stopLossPlacement: "Opposite side of the candle's extreme range.",
    priceTarget: "Measured move equal to candle range. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After strong trend legs where volatility expands. Near exhaustion zones."
  },
  {
    id: "hammer",
    name: "Hammer",
    type: "bullish",
    candles: 1,
    description: "Small body near the top with a long lower shadow (≥2× body). Bullish reversal after downtrend.",
    formation: "Small body in top 25% of range. Lower shadow ≥2× body length. Upper shadow minimal or absent.",
    psychology: "Sellers pushed price down but buyers recovered strongly to close near the high. Bearish exhaustion.",
    signal: "buy",
    reliability: "high",
    confirmation: "Bullish candle closing above the Hammer's high on next session with volume.",
    stopLossPlacement: "Below the Hammer's shadow low or 1× ATR below entry.",
    priceTarget: "Recent swing high. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend. At support levels or oversold conditions."
  },
  {
    id: "hanging_man",
    name: "Hanging Man",
    type: "bearish",
    candles: 1,
    description: "Looks like a Hammer but appears after an uptrend. Bearish reversal warning.",
    formation: "Small body in top 25% of range. Long lower shadow (≥2× body). Appears after uptrend.",
    psychology: "Sellers made a significant push during the session. Buyers recovered but momentum may be shifting.",
    signal: "sell",
    reliability: "moderate",
    confirmation: "Bearish candle closing below the Hanging Man's low on next session.",
    stopLossPlacement: "Above the Hanging Man's high.",
    priceTarget: "Recent swing low. Scale at 1.5–2R.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After an extended uptrend. Near resistance or overbought zones."
  },
  {
    id: "inverted_hammer",
    name: "Inverted Hammer",
    type: "bullish",
    candles: 1,
    description: "Small body near the bottom with a long upper shadow. Bullish reversal after downtrend.",
    formation: "Small body in bottom 25% of range. Upper shadow ≥2× body. Lower shadow minimal.",
    psychology: "Buyers attempted to rally but were pushed back. However, the attempt shows emerging demand.",
    signal: "buy",
    reliability: "moderate",
    confirmation: "Bullish candle closing above the Inverted Hammer's high.",
    stopLossPlacement: "Below the Inverted Hammer's low.",
    priceTarget: "Recent swing high. Scale at 1.5–2R.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend. At support levels."
  },
  {
    id: "shooting_star",
    name: "Shooting Star",
    type: "bearish",
    candles: 1,
    description: "Small body near the bottom with a long upper shadow. Bearish reversal after uptrend.",
    formation: "Small body in bottom 25% of range. Upper shadow ≥2× body. Appears after uptrend.",
    psychology: "Buyers pushed price up strongly but sellers overwhelmed them by the close. Failed rally.",
    signal: "sell",
    reliability: "high",
    confirmation: "Bearish candle closing below the Shooting Star's low with volume.",
    stopLossPlacement: "Above the Shooting Star's shadow high.",
    priceTarget: "Recent swing low. Scale at 1.5–2R.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend. Near resistance zones."
  },
  {
    id: "spinning_top_bullish",
    name: "Bullish Spinning Top",
    type: "bullish",
    candles: 1,
    description: "Small green body in the middle of long shadows. Shows emerging buying interest after decline.",
    formation: "Small green body (10–25% of range). Upper and lower shadows roughly equal. Close > Open.",
    psychology: "Bears pushed lower but buyers recovered to close green. Downward momentum is weakening.",
    signal: "buy",
    reliability: "moderate",
    confirmation: "Next candle closes above the Spinning Top's high with volume > 120% of average.",
    stopLossPlacement: "Below the Spinning Top's low or 1× ATR below entry.",
    priceTarget: "Nearest swing high. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend or pullback. Stronger when appearing at support."
  },
  {
    id: "spinning_top_bearish",
    name: "Bearish Spinning Top",
    type: "bearish",
    candles: 1,
    description: "Small red body in the middle of long shadows. Shows emerging selling pressure after rally.",
    formation: "Small red body (10–25% of range). Upper and lower shadows roughly equal. Close < Open.",
    psychology: "Buyers pushed higher but sellers recovered to close red. Upward momentum is weakening.",
    signal: "sell",
    reliability: "moderate",
    confirmation: "Next candle closes below the Spinning Top's low with bearish volume.",
    stopLossPlacement: "Above the Spinning Top's high or 1× ATR above entry.",
    priceTarget: "Nearest swing low. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend or rally. Near resistance or overbought zones."
  },
  {
    id: "pin_bar_bullish",
    name: "Bullish Pin Bar",
    type: "bullish",
    candles: 1,
    description: "Long lower tail with small body near the top. Strong rejection of lower prices.",
    formation: "Body ≤15% of range. Lower wick ≥2/3 of entire candle. Close in top 25% of range.",
    psychology: "Market tested lower levels aggressively but reversed sharply. Buyers firmly in control.",
    signal: "buy",
    reliability: "high",
    confirmation: "Next 1-2 candles close higher with volume. Supported by trendlines/Fibonacci adds strength.",
    stopLossPlacement: "Beyond the wick tip (below the low).",
    priceTarget: "Recent swing high. Extend at 2R multiples. Trail under higher lows.",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "At downtrend lows or support levels. In trending markets for continuation."
  },
  {
    id: "pin_bar_bearish",
    name: "Bearish Pin Bar",
    type: "bearish",
    candles: 1,
    description: "Long upper tail with small body near the bottom. Strong rejection of higher prices.",
    formation: "Body ≤15% of range. Upper wick ≥2/3 of entire candle. Close in bottom 25% of range.",
    psychology: "Market tested higher levels aggressively but reversed sharply. Sellers firmly in control.",
    signal: "sell",
    reliability: "high",
    confirmation: "Next 1-2 candles close lower with volume. Supported by resistance adds strength.",
    stopLossPlacement: "Beyond the wick tip (above the high).",
    priceTarget: "Recent swing low. Extend at 2R multiples. Trail above lower highs.",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "At uptrend highs or resistance levels. In trending markets for continuation."
  },

  // ==================== TWO CANDLE PATTERNS ====================
  {
    id: "bullish_engulfing",
    name: "Bullish Engulfing",
    type: "bullish",
    candles: 2,
    description: "A small red candle followed by a larger green candle that completely engulfs the previous body.",
    formation: "Candle 1: Small red body. Candle 2: Green body that fully covers (engulfs) Candle 1's body.",
    psychology: "Day 1 sellers were in control. Day 2 buyers overwhelmed them completely, erasing all losses.",
    signal: "buy",
    reliability: "high",
    confirmation: "Third candle closes higher with volume. More reliable after a clear downtrend.",
    stopLossPlacement: "Below the low of the engulfing pattern (Candle 2 low) or 1× ATR below.",
    priceTarget: "Recent swing high. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend. At support levels."
  },
  {
    id: "bearish_engulfing",
    name: "Bearish Engulfing",
    type: "bearish",
    candles: 2,
    description: "A small green candle followed by a larger red candle that completely engulfs the previous body.",
    formation: "Candle 1: Small green body. Candle 2: Red body that fully covers (engulfs) Candle 1's body.",
    psychology: "Day 1 buyers were in control. Day 2 sellers overwhelmed them completely, erasing all gains.",
    signal: "sell",
    reliability: "high",
    confirmation: "Third candle closes lower with volume. More reliable after a clear uptrend.",
    stopLossPlacement: "Above the high of the engulfing pattern (Candle 2 high) or 1× ATR above.",
    priceTarget: "Recent swing low. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend. At resistance levels."
  },
  {
    id: "piercing_line",
    name: "Piercing Line",
    type: "bullish",
    candles: 2,
    description: "A long red candle followed by a green candle that opens below the prior low but closes above the midpoint of the prior body.",
    formation: "Candle 1: Long red body. Candle 2: Green body that opens below Candle 1 low and closes above 50% of Candle 1's body.",
    psychology: "Selling continues at the open but buyers step in strongly, recovering more than half of the prior day's losses.",
    signal: "buy",
    reliability: "high",
    confirmation: "Third candle closes above the Piercing Line high with volume.",
    stopLossPlacement: "Below the Candle 2 low.",
    priceTarget: "Recent swing high. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend. At support levels."
  },
  {
    id: "dark_cloud_cover",
    name: "Dark Cloud Cover",
    type: "bearish",
    candles: 2,
    description: "A long green candle followed by a red candle that opens above the prior high but closes below the midpoint of the prior body.",
    formation: "Candle 1: Long green body. Candle 2: Red body that opens above Candle 1 high and closes below 50% of Candle 1's body.",
    psychology: "Buying continues at the open but sellers step in strongly, erasing more than half of the prior day's gains.",
    signal: "sell",
    reliability: "high",
    confirmation: "Third candle closes below the Dark Cloud Cover low with volume.",
    stopLossPlacement: "Above the Candle 2 high.",
    priceTarget: "Recent swing low. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend. At resistance levels."
  },
  {
    id: "bullish_harami",
    name: "Bullish Harami",
    type: "bullish",
    candles: 2,
    description: "A large red candle followed by a small green candle completely inside the prior body. Potential trend pause/reversal.",
    formation: "Candle 1: Large red body. Candle 2: Small green body entirely within the range of Candle 1's body.",
    psychology: "Selling momentum pauses. The small inside candle shows indecision and possible buyer emergence.",
    signal: "buy",
    reliability: "moderate",
    confirmation: "Third candle closes above the Harami high with volume.",
    stopLossPlacement: "Below the Candle 1 low.",
    priceTarget: "Recent swing high. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend."
  },
  {
    id: "bearish_harami",
    name: "Bearish Harami",
    type: "bearish",
    candles: 2,
    description: "A large green candle followed by a small red candle completely inside the prior body. Potential trend pause/reversal.",
    formation: "Candle 1: Large green body. Candle 2: Small red body entirely within the range of Candle 1's body.",
    psychology: "Buying momentum pauses. The small inside candle shows indecision and possible seller emergence.",
    signal: "sell",
    reliability: "moderate",
    confirmation: "Third candle closes below the Harami low with volume.",
    stopLossPlacement: "Above the Candle 1 high.",
    priceTarget: "Recent swing low. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend."
  },
  {
    id: "tweezer_bottom",
    name: "Tweezer Bottom",
    type: "bullish",
    candles: 2,
    description: "Two candles with matching or nearly matching lows. Shows strong support and potential bullish reversal.",
    formation: "Candle 1: Any candle with a distinct lower shadow. Candle 2: Body of opposite color with low matching Candle 1's low.",
    psychology: "Price was rejected at the same level twice. Support is strong and bears are losing control.",
    signal: "buy",
    reliability: "high",
    confirmation: "Third candle closes above the Tweezer high with volume.",
    stopLossPlacement: "Below the matching lows.",
    priceTarget: "Recent swing high. Scale at 1.5–2R.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend. At support levels."
  },
  {
    id: "tweezer_top",
    name: "Tweezer Top",
    type: "bearish",
    candles: 2,
    description: "Two candles with matching or nearly matching highs. Shows strong resistance and potential bearish reversal.",
    formation: "Candle 1: Any candle with a distinct upper shadow. Candle 2: Body of opposite color with high matching Candle 1's high.",
    psychology: "Price was rejected at the same level twice. Resistance is strong and bulls are losing control.",
    signal: "sell",
    reliability: "high",
    confirmation: "Third candle closes below the Tweezer low with volume.",
    stopLossPlacement: "Above the matching highs.",
    priceTarget: "Recent swing low. Scale at 1.5–2R.",
    bestTimeframes: ["15m", "1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend. At resistance levels."
  },

  // ==================== THREE CANDLE PATTERNS ====================
  {
    id: "morning_star",
    name: "Morning Star",
    type: "bullish",
    candles: 3,
    description: "A long red candle, a small-bodied indecision candle (Doji or Spinning Top), then a long green candle. Strong bullish reversal.",
    formation: "Candle 1: Long red body. Candle 2: Small body (gap down ideal). Candle 3: Long green body closing deep into Candle 1's body.",
    psychology: "Selling exhausts (Candle 1), indecision hits (Candle 2), then buyers take control decisively (Candle 3).",
    signal: "buy",
    reliability: "high",
    confirmation: "Fourth candle sustains above Candle 3 close with volume.",
    stopLossPlacement: "Below the Morning Star low (Candle 2 low) or 1× ATR below.",
    priceTarget: "Recent swing high. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After a clear downtrend. At major support."
  },
  {
    id: "evening_star",
    name: "Evening Star",
    type: "bearish",
    candles: 3,
    description: "A long green candle, a small-bodied indecision candle, then a long red candle. Strong bearish reversal.",
    formation: "Candle 1: Long green body. Candle 2: Small body (gap up ideal). Candle 3: Long red body closing deep into Candle 1's body.",
    psychology: "Buying exhausts (Candle 1), indecision hits (Candle 2), then sellers take control decisively (Candle 3).",
    signal: "sell",
    reliability: "high",
    confirmation: "Fourth candle sustains below Candle 3 close with volume.",
    stopLossPlacement: "Above the Evening Star high (Candle 2 high) or 1× ATR above.",
    priceTarget: "Recent swing low. Scale at 1.5–2R. Trail with EMA(8/20).",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After a clear uptrend. At major resistance."
  },
  {
    id: "three_white_soldiers",
    name: "Three White Soldiers",
    type: "bullish",
    candles: 3,
    description: "Three consecutive green candles with higher closes and small upper shadows. Strong bullish continuation/reversal.",
    formation: "Three green candles, each closing higher than prior. Small or no upper shadows. Opens within prior candle's body.",
    psychology: "Sustained buying pressure across three sessions. Buyers are in firm control with little selling resistance.",
    signal: "buy",
    reliability: "high",
    confirmation: "Fourth candle continues green or consolidates above the pattern.",
    stopLossPlacement: "Below the low of the third soldier or 1× ATR below.",
    priceTarget: "Extend at 2R–3R multiples. Trail with EMA(8/20).",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After a downtrend (reversal) or during uptrend (continuation)."
  },
  {
    id: "three_black_crows",
    name: "Three Black Crows",
    type: "bearish",
    candles: 3,
    description: "Three consecutive red candles with lower closes and small lower shadows. Strong bearish continuation/reversal.",
    formation: "Three red candles, each closing lower than prior. Small or no lower shadows. Opens within prior candle's body.",
    psychology: "Sustained selling pressure across three sessions. Sellers are in firm control with little buying resistance.",
    signal: "sell",
    reliability: "high",
    confirmation: "Fourth candle continues red or consolidates below the pattern.",
    stopLossPlacement: "Above the high of the third crow or 1× ATR above.",
    priceTarget: "Extend at 2R–3R multiples. Trail with EMA(8/20).",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "After an uptrend (reversal) or during downtrend (continuation)."
  },
  {
    id: "rising_three",
    name: "Rising Three (Bullish Continuation)",
    type: "continuation",
    candles: 3,
    description: "A long green candle, three small consolidation candles, then another green candle. Bullish continuation.",
    formation: "Candle 1: Long green. Candles 2-4: Small-bodied consolidation candles within Candle 1's range. Candle 5: Green breaking above.",
    psychology: "Strong up move, brief consolidation where sellers fail to push price down, then buyers resume control.",
    signal: "buy",
    reliability: "high",
    confirmation: "Candle 5 closes above Candle 1 high with volume.",
    stopLossPlacement: "Below the consolidation range low.",
    priceTarget: "Measured move = height of Candle 1 added to breakout point. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "During an uptrend. Shows continuation after brief pause."
  },
  {
    id: "falling_three",
    name: "Falling Three (Bearish Continuation)",
    type: "continuation",
    candles: 3,
    description: "A long red candle, three small consolidation candles, then another red candle. Bearish continuation.",
    formation: "Candle 1: Long red. Candles 2-4: Small-bodied consolidation candles within Candle 1's range. Candle 5: Red breaking below.",
    psychology: "Strong down move, brief consolidation where buyers fail to push price up, then sellers resume control.",
    signal: "sell",
    reliability: "high",
    confirmation: "Candle 5 closes below Candle 1 low with volume.",
    stopLossPlacement: "Above the consolidation range high.",
    priceTarget: "Measured move = height of Candle 1 subtracted from breakout point. Scale at 1.5–2R.",
    bestTimeframes: ["1h", "4h", "1d"],
    bestMarketConditions: "During a downtrend. Shows continuation after brief pause."
  },

  // ==================== CHART PATTERNS (from BullishBears) ====================
  {
    id: "bull_flag",
    name: "Bull Flag",
    type: "continuation",
    candles: 5,
    description: "A sharp upward move (flag pole) followed by a shallow downward consolidation (flag), then continuation up.",
    formation: "Flag pole: steep rally. Flag: parallel downward channel or slight pullback. Volume decreases during flag.",
    psychology: "Strong buying (pole), then profit-taking/shorts enter (flag). Buyers re-enter on breakout.",
    signal: "buy",
    reliability: "high",
    confirmation: "Breakout above the flag upper boundary with volume surge.",
    stopLossPlacement: "Below the flag low or below the consolidation range.",
    priceTarget: "Measured move = pole height added to breakout point.",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "Strong trending markets. One of the most reliable continuation patterns."
  },
  {
    id: "bear_flag",
    name: "Bear Flag",
    type: "continuation",
    candles: 5,
    description: "A sharp downward move (flag pole) followed by a shallow upward consolidation (flag), then continuation down.",
    formation: "Flag pole: steep drop. Flag: parallel upward channel or slight bounce. Volume decreases during flag.",
    psychology: "Strong selling (pole), then short covering/buyers enter (flag). Sellers re-enter on breakdown.",
    signal: "sell",
    reliability: "high",
    confirmation: "Breakdown below the flag lower boundary with volume surge.",
    stopLossPlacement: "Above the flag high or above the consolidation range.",
    priceTarget: "Measured move = pole height subtracted from breakdown point.",
    bestTimeframes: ["5m", "15m", "1h", "4h", "1d"],
    bestMarketConditions: "Strong downtrending markets. One of the most reliable continuation patterns."
  },
  {
    id: "cup_and_handle",
    name: "Cup and Handle",
    type: "bullish",
    candles: 20,
    description: "A U-shaped cup followed by a small downward consolidation (handle), then a breakout.",
    formation: "Cup: gradual U-shape decline and recovery over weeks/months. Handle: brief shallow pullback. Volume increases on breakout.",
    psychology: "Long accumulation (cup), final shakeout (handle), then institutional buying drives breakout.",
    signal: "buy",
    reliability: "high",
    confirmation: "Breakout above the handle's resistance with volume ≥150% of average.",
    stopLossPlacement: "Below the handle low or below the cup's right-side support.",
    priceTarget: "Measured move = cup depth added to breakout point. Often multi-month target.",
    bestTimeframes: ["1d", "1w", "1mo"],
    bestMarketConditions: "Long-term bullish markets. Growth stocks. Works best after basing period."
  },
  {
    id: "head_and_shoulders_top",
    name: "Head and Shoulders Top",
    type: "bearish",
    candles: 15,
    description: "Three peaks: left shoulder, higher head, right shoulder. Break below neckline = bearish reversal.",
    formation: "Left shoulder: rally + pullback. Head: higher rally + pullback. Right shoulder: lower rally. Neckline connects the lows.",
    psychology: "Buyers make three attempts, each weaker. Failed new high shows exhaustion. Break of neckline confirms trend change.",
    signal: "sell",
    reliability: "high",
    confirmation: "Close below neckline with volume. Pullback to neckline that holds as resistance adds confidence.",
    stopLossPlacement: "Above the right shoulder or above the neckline on pullback.",
    priceTarget: "Measured move = head-to-neckline distance subtracted from breakdown point.",
    bestTimeframes: ["4h", "1d", "1w"],
    bestMarketConditions: "After extended uptrends. Major reversal pattern across all markets."
  },
  {
    id: "inverse_head_and_shoulders",
    name: "Inverse Head and Shoulders",
    type: "bullish",
    candles: 15,
    description: "Three troughs: left shoulder, lower head, right shoulder. Break above neckline = bullish reversal.",
    formation: "Left shoulder: drop + bounce. Head: lower drop + bounce. Right shoulder: higher drop. Neckline connects the highs.",
    psychology: "Sellers make three attempts, each weaker. Failed new low shows exhaustion. Break of neckline confirms trend change.",
    signal: "buy",
    reliability: "high",
    confirmation: "Close above neckline with volume. Pullback to neckline that holds as support adds confidence.",
    stopLossPlacement: "Below the right shoulder or below the neckline on pullback.",
    priceTarget: "Measured move = head-to-neckline distance added to breakout point.",
    bestTimeframes: ["4h", "1d", "1w"],
    bestMarketConditions: "After extended downtrends. Major reversal pattern across all markets."
  },
  {
    id: "rising_wedge",
    name: "Rising Wedge",
    type: "bearish",
    candles: 10,
    description: "Converging upward trendlines that slope up. Bearish reversal/continuation pattern.",
    formation: "Two converging upward trendlines. Upper trendline has lower slope than lower trendline. Volume decreases.",
    psychology: "Buying continues but momentum slows. Each rally is smaller. Eventually sellers overwhelm.",
    signal: "sell",
    reliability: "high",
    confirmation: "Break below the lower wedge trendline with volume.",
    stopLossPlacement: "Above the wedge's last pivot high or 1× ATR above.",
    priceTarget: "Start of the wedge formation. Often swift move.",
    bestTimeframes: ["1h", "4h", "1d", "1w"],
    bestMarketConditions: "After uptrends (reversal) or during uptrends (continuation down). Typically 3-6 weeks to form."
  },
  {
    id: "falling_wedge",
    name: "Falling Wedge",
    type: "bullish",
    candles: 10,
    description: "Converging downward trendlines that slope down. Bullish reversal/continuation pattern.",
    formation: "Two converging downward trendlines. Lower trendline has steeper slope. Volume decreases.",
    psychology: "Selling continues but momentum slows. Each drop is smaller. Eventually buyers overwhelm.",
    signal: "buy",
    reliability: "high",
    confirmation: "Break above the upper wedge trendline with volume.",
    stopLossPlacement: "Below the wedge's last pivot low or 1× ATR below.",
    priceTarget: "Start of the wedge formation. Often swift move.",
    bestTimeframes: ["1h", "4h", "1d", "1w"],
    bestMarketConditions: "After downtrends (reversal) or during downtrends (continuation up). Typically 3-6 weeks to form."
  }
];

// ==================== UTILITY FUNCTIONS ====================

/**
 * Find patterns matching a given trend context and candle count
 */
export function findPatternsByContext(
  type: PatternType,
  candles?: number
): CandlestickPattern[] {
  return CANDLESTICK_PATTERNS.filter(
    (p) => p.type === type && (candles === undefined || p.candles === candles)
  );
}

/**
 * Get a pattern by its unique ID
 */
export function getPatternById(id: string): CandlestickPattern | undefined {
  return CANDLESTICK_PATTERNS.find((p) => p.id === id);
}

/**
 * Get all high-reliability patterns (for AI to prioritize)
 */
export function getHighReliabilityPatterns(): CandlestickPattern[] {
  return CANDLESTICK_PATTERNS.filter((p) => p.reliability === "high");
}

/**
 * Format patterns into a concise text reference for AI prompts
 * Limits output to avoid token bloat
 */
export function formatPatternsForAI(maxPatterns: number = 15): string {
  const patterns = getHighReliabilityPatterns().slice(0, maxPatterns);
  return patterns
    .map(
      (p) =>
        `- ${p.name} (${p.type}, ${p.candles}-candle): ${p.description} Signal: ${p.signal}. Confirmation: ${p.confirmation}`
    )
    .join("\n");
}

/**
 * Format all single-candle patterns for quick reference
 */
export function formatSingleCandlePatterns(): string {
  return CANDLESTICK_PATTERNS.filter((p) => p.candles === 1)
    .map(
      (p) =>
        `${p.name}: ${p.description} Signal: ${p.signal}. Reliability: ${p.reliability}`
    )
    .join("\n");
}

/**
 * Format all reversal patterns
 */
export function formatReversalPatterns(): string {
  const reversalTypes: PatternType[] = ["bullish", "bearish", "reversal"];
  return CANDLESTICK_PATTERNS.filter((p) => reversalTypes.includes(p.type))
    .map(
      (p) =>
        `${p.name} (${p.candles}c): ${p.description} → ${p.signal.toUpperCase()}`
    )
    .join("\n");
}
