import { adx } from "./features";
import { atr, ema, macd, rsi, type Bar, type Num } from "./indicators";
import { etParts, isRegularSession } from "./time";

/** Opening range length in 5 minute bars (9:30 to 9:45 ET). */
export const OR_BARS = 3;
export const BAR_MS = 5 * 60_000;
const RVOL_LOOKBACK = 10;

export type Direction = "long" | "short";
export type Action = "BUY" | "SELL" | "WAIT";

export const WEIGHTS = {
  trend: 15,
  vwap: 15,
  macd: 10,
  rsi: 10,
  volume: 15,
  breakout: 15,
  market: 10,
  reward: 10,
} as const;

export type Component = keyof typeof WEIGHTS;
export type Components = Record<Component, number>;

export const COMPONENT_LABELS: Record<Component, string> = {
  trend: "EMA 9/21 trend",
  vwap: "VWAP",
  macd: "MACD",
  rsi: "RSI 14",
  volume: "Relative volume",
  breakout: "Opening range",
  market: "SPY and QQQ",
  reward: "Reward to risk",
};

export interface Series {
  bars: Bar[];
  session: string[];
  barOfSession: number[];
  ema9: Num[];
  ema21: Num[];
  rsi14: Num[];
  hist: Num[];
  atr14: Num[];
  vwap: number[];
  orHigh: Num[];
  orLow: Num[];
  rvol: Num[];
  dayHigh: number[];
  dayLow: number[];
  index: Map<number, number>;
}

/** Builds causal indicator series: the value at index i only uses bars 0..i. */
export function buildSeries(rawBars: Bar[]): Series {
  const bars = rawBars.filter((b) => isRegularSession(b.t)).sort((a, b) => a.t - b.t);
  const closes = bars.map((b) => b.c);
  const session: string[] = [];
  const barOfSession: number[] = [];
  const vwap: number[] = [];
  const orHigh: Num[] = [];
  const orLow: Num[] = [];
  const rvol: Num[] = [];
  const dayHigh: number[] = [];
  const dayLow: number[] = [];
  const cumBySession: number[][] = [];

  let pv = 0;
  let vol = 0;
  let hi = -Infinity;
  let lo = Infinity;
  let orH = -Infinity;
  let orL = Infinity;
  let n = -1;
  let current = "";

  bars.forEach((b) => {
    const date = etParts(b.t).date;
    if (date !== current) {
      current = date;
      pv = 0;
      vol = 0;
      hi = -Infinity;
      lo = Infinity;
      orH = -Infinity;
      orL = Infinity;
      n = -1;
      cumBySession.push([]);
    }
    n += 1;
    session.push(date);
    barOfSession.push(n);
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    vwap.push(vol > 0 ? pv / vol : typical);
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    dayHigh.push(hi);
    dayLow.push(lo);
    if (n < OR_BARS) {
      orH = Math.max(orH, b.h);
      orL = Math.min(orL, b.l);
    }
    orHigh.push(n >= OR_BARS - 1 ? orH : null);
    orLow.push(n >= OR_BARS - 1 ? orL : null);

    const today = cumBySession[cumBySession.length - 1];
    today.push(vol);
    const history = cumBySession.slice(-1 - RVOL_LOOKBACK, -1).map((s) => s[n]).filter((x) => x != null && x > 0);
    rvol.push(history.length >= 3 ? vol / (history.reduce((a, x) => a + x, 0) / history.length) : null);
  });

  return {
    bars,
    session,
    barOfSession,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    hist: macd(closes).hist,
    atr14: atr(bars, 14),
    vwap,
    orHigh,
    orLow,
    rvol,
    dayHigh,
    dayLow,
    index: new Map(bars.map((b, i) => [b.t, i])),
  };
}

export interface DailyBar {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** 14 day ATR using only sessions strictly before `beforeDate`. */
export function dailyAtr(daily: DailyBar[], beforeDate: string): number | null {
  const prior = daily.filter((d) => d.date < beforeDate);
  const values = atr(
    prior.map((d) => ({ t: 0, o: d.o, h: d.h, l: d.l, c: d.c, v: 0 })),
    14,
  );
  return values[values.length - 1] ?? null;
}

export interface Trend {
  aboveVwap: boolean;
  emaUp: boolean;
  belowVwap: boolean;
  emaDown: boolean;
}

/** Market direction from an index ETF at the latest bar at or before time t. */
export function trendAt(s: Series | null, t: number): Trend | null {
  if (!s || s.bars.length === 0) return null;
  let i = s.index.get(t);
  if (i == null) {
    // Fall back to the latest bar before t in the same session.
    let lo = 0;
    let hi = s.bars.length - 1;
    if (s.bars[0].t > t) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s.bars[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    if (t - s.bars[lo].t > 30 * 60_000) return null;
    i = lo;
  }
  const e9 = s.ema9[i];
  const e21 = s.ema21[i];
  const c = s.bars[i].c;
  return {
    aboveVwap: c > s.vwap[i],
    belowVwap: c < s.vwap[i],
    emaUp: e9 != null && e21 != null && e9 > e21,
    emaDown: e9 != null && e21 != null && e9 < e21,
  };
}

export interface Plan {
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  rr: number;
}

export interface SideScore {
  score: number;
  components: Components;
  plan: Plan;
}

export interface Metrics {
  price: number;
  vwap: number;
  ema9: number;
  ema21: number;
  rsi: number;
  hist: number;
  atr: number;
  rvol: number | null;
  orHigh: number;
  orLow: number;
}

export interface ScoreResult {
  long: SideScore;
  short: SideScore;
  metrics: Metrics;
}

export interface ScoreInput {
  s: Series;
  i: number;
  price: number;
  dailyAtr: number | null;
  spy: Trend | null;
  qqq: Trend | null;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

// Stops sit beyond the nearest support or resistance but never inside normal 5 minute noise.
// Targets use the opening range as a measured move, bounded so a wide open cannot inflate reward to risk.
const MIN_STOP_ATR = 1;
const MAX_STOP_ATR = 2.5;
const MIN_TARGET_ATR = 2;
const MAX_TARGET_ATR = 4;

function planFor(direction: Direction, m: Metrics, dayHigh: number, dayLow: number, dAtr: number | null): Plan {
  const { price, atr: a } = m;
  const range = m.orHigh - m.orLow;
  if (direction === "long") {
    const supports = [m.vwap, m.ema21, price > m.orHigh ? m.orHigh : -Infinity].filter((x) => x < price);
    const base = supports.length ? Math.max(...supports) - 0.25 * a : price - 1.5 * a;
    const dist = clamp(price - base, MIN_STOP_ATR * a, MAX_STOP_ATR * a);
    const raw = price + clamp(range, MIN_TARGET_ATR * a, MAX_TARGET_ATR * a);
    const cap = dAtr != null ? Math.min(dayLow, price) + 1.2 * dAtr : Infinity;
    const target = Math.min(raw, cap);
    return { direction, entry: price, stop: price - dist, target, rr: target > price ? (target - price) / dist : 0 };
  }
  const resistances = [m.vwap, m.ema21, price < m.orLow ? m.orLow : Infinity].filter((x) => x > price);
  const base = resistances.length ? Math.min(...resistances) + 0.25 * a : price + 1.5 * a;
  const dist = clamp(base - price, MIN_STOP_ATR * a, MAX_STOP_ATR * a);
  const raw = price - clamp(range, MIN_TARGET_ATR * a, MAX_TARGET_ATR * a);
  const cap = dAtr != null ? Math.max(dayHigh, price) - 1.2 * dAtr : -Infinity;
  const target = Math.max(raw, cap);
  return { direction, entry: price, stop: price + dist, target, rr: target < price ? (price - target) / dist : 0 };
}

function rewardPoints(rr: number) {
  if (rr >= 3) return 10;
  if (rr >= 2.5) return 8;
  if (rr >= 2) return 6;
  return 0;
}

function volumePoints(rv: number | null) {
  if (rv == null) return 0;
  if (rv >= 2) return 15;
  if (rv >= 1.5) return 11;
  if (rv >= 1.2) return 7;
  if (rv >= 1) return 3;
  return 0;
}

function marketPoints(t: Trend | null, dir: Direction) {
  if (!t) return 0;
  const a = dir === "long" ? t.aboveVwap : t.belowVwap;
  const b = dir === "long" ? t.emaUp : t.emaDown;
  return a && b ? 5 : a || b ? 2 : 0;
}

function rsiPoints(r: number, dir: Direction) {
  const x = dir === "long" ? r : 100 - r;
  if (x >= 55 && x <= 70) return 10;
  if ((x >= 50 && x < 55) || (x > 70 && x <= 75)) return 6;
  if (x >= 45 && x < 50) return 2;
  return 0;
}

/** Scores both directions at bar i. Returns null until every indicator is ready. */
export function scoreAt(input: ScoreInput): ScoreResult | null {
  const { s, i, price } = input;
  const e9 = s.ema9[i];
  const e21 = s.ema21[i];
  const r = s.rsi14[i];
  const h = s.hist[i];
  const hPrev = s.hist[i - 1];
  const a = s.atr14[i];
  const orH = s.orHigh[i];
  const orL = s.orLow[i];
  if (e9 == null || e21 == null || r == null || h == null || hPrev == null || a == null || orH == null || orL == null) {
    return null;
  }
  if (a <= 0) return null;
  const m: Metrics = { price, vwap: s.vwap[i], ema9: e9, ema21: e21, rsi: r, hist: h, atr: a, rvol: s.rvol[i], orHigh: orH, orLow: orL };
  const dayHigh = Math.max(s.dayHigh[i], price);
  const dayLow = Math.min(s.dayLow[i], price);
  const orMid = (orH + orL) / 2;

  const side = (dir: Direction): SideScore => {
    const up = dir === "long";
    const plan = planFor(dir, m, dayHigh, dayLow, input.dailyAtr);
    const extended = Math.abs(price - m.vwap) > 1.5 * a;
    const components: Components = {
      trend: ((up ? e9 > e21 : e9 < e21) ? 10 : 0) + ((up ? price > e9 : price < e9) ? 5 : 0),
      vwap: (up ? price > m.vwap : price < m.vwap) ? 10 + (extended ? 0 : 5) : 0,
      macd: (up ? h > 0 : h < 0) ? 6 + ((up ? h > hPrev : h < hPrev) ? 4 : 0) : 0,
      rsi: rsiPoints(r, dir),
      volume: volumePoints(m.rvol),
      breakout: up ? (price > orH ? 15 : price > orMid ? 5 : 0) : price < orL ? 15 : price < orMid ? 5 : 0,
      market: marketPoints(input.spy, dir) + marketPoints(input.qqq, dir),
      reward: rewardPoints(plan.rr),
    };
    const score = Object.values(components).reduce((x, y) => x + y, 0);
    return { score, components, plan };
  };

  return { long: side("long"), short: side("short"), metrics: m };
}

export interface DecideOptions {
  minScore: number;
  minRR: number;
}

export interface Signal {
  action: Action;
  direction: Direction | null;
  score: number;
  plan: Plan | null;
  components: Components | null;
  reason: string;
}

export function decide(result: ScoreResult | null, opts: DecideOptions, gate: string | null = null): Signal {
  if (!result) {
    return { action: "WAIT", direction: null, score: 0, plan: null, components: null, reason: gate ?? "Not enough data yet." };
  }
  const best = result.long.score >= result.short.score ? result.long : result.short;
  const dir = best.plan.direction;
  const qualifies = best.score >= opts.minScore && best.plan.rr >= opts.minRR;
  if (gate || !qualifies) {
    return {
      action: "WAIT",
      direction: dir,
      score: best.score,
      plan: best.plan,
      components: best.components,
      reason: gate ?? waitReason(best, result.metrics, opts),
    };
  }
  return {
    action: dir === "long" ? "BUY" : "SELL",
    direction: dir,
    score: best.score,
    plan: best.plan,
    components: best.components,
    reason: entryReason(best, result.metrics),
  };
}

function entryReason(side: SideScore, m: Metrics): string {
  const up = side.plan.direction === "long";
  const c = side.components;
  const lead = side.score >= 85 ? (up ? "Strong momentum" : "Strong selling") : up ? "Momentum" : "Selling pressure";
  const where = c.vwap > 0 ? (up ? " above VWAP" : " below VWAP") : "";
  const extras: string[] = [];
  if (c.volume >= 7 && m.rvol != null) extras.push(`${m.rvol.toFixed(1)}x normal volume`);
  if (c.breakout === 15) extras.push(up ? "an opening range breakout" : "an opening range breakdown");
  if (extras.length === 0 && c.market >= 8) extras.push(up ? "a rising market" : "a falling market");
  if (extras.length === 0 && c.trend === 15) extras.push(up ? "a rising trend" : "a falling trend");
  const tail = extras.length ? ` with ${extras.join(" and ")}` : "";
  return `${lead}${where}${tail}.`;
}

function waitReason(side: SideScore, m: Metrics, opts: DecideOptions): string {
  const c = side.components;
  if (side.plan.rr < opts.minRR) return `Reward is only ${side.plan.rr.toFixed(1)}x the risk.`;
  if (c.trend < 10 && c.vwap === 0) return "Trend and VWAP disagree.";
  if (c.volume <= 3) return m.rvol == null ? "Volume history is missing." : "Volume is too light.";
  if (c.breakout === 0) return "Price is still inside its opening range.";
  if (c.market <= 2) return "Market direction is against it.";
  return `Score ${side.score} is under the ${opts.minScore} needed.`;
}

/** Index of the last bar that has fully closed by `now`. */
export function lastClosedIndex(s: Series, now: number): number {
  for (let i = s.bars.length - 1; i >= 0; i--) {
    if (s.bars[i].t + BAR_MS <= now) return i;
  }
  return -1;
}

/* ---------------------------------------------------------------------------------------------
 * Swing trend mode (daily bars, long only).
 * Walk-forward tested on 2025-05 to 2026-07 and a 2026-07 to 2026-10 holdout (scripts/optimize.mts).
 * Decide on the last COMPLETED daily bar, enter at the next open, exit on stop, target or after
 * SWING_MAX_SESSIONS sessions.
 * ------------------------------------------------------------------------------------------- */

export const SWING_WEIGHTS = { trend: 30, adx: 25, breakout: 20, strength: 15, reward: 10 } as const;
export type SwingComponent = keyof typeof SWING_WEIGHTS;
export const SWING_LABELS: Record<SwingComponent, string> = {
  trend: "Daily EMA 20/50 trend",
  adx: "ADX trend strength",
  breakout: "20 day high",
  strength: "Strength vs QQQ",
  reward: "Reward to risk",
};
export const SWING_STOP_ATR = 1.5;
export const SWING_TARGET_ATR = 3;
export const SWING_MAX_SESSIONS = 5;

export interface SwingSignal {
  action: "BUY" | "WAIT";
  score: number;
  components: Record<SwingComponent, number>;
  plan: Plan | null;
  reason: string;
}

/**
 * Evaluates the long only swing setup on completed daily bars (ascending, last element = latest
 * completed session). `qqq` must cover the same dates. Entry needs ALL of: EMA20 > EMA50 and close
 * above EMA20; ADX above 25 with +DI above -DI; and a close at a 20 day high or a 20 day return at
 * least 5 points better than QQQ.
 */
export function swingTrendSignal(daily: DailyBar[], qqq: DailyBar[]): SwingSignal {
  const zero: Record<SwingComponent, number> = { trend: 0, adx: 0, breakout: 0, strength: 0, reward: 0 };
  const k = daily.length - 1;
  if (k < 60) return { action: "WAIT", score: 0, components: zero, plan: null, reason: "Not enough daily history yet." };
  const closes = daily.map((d) => d.c);
  const e20 = ema(closes, 20)[k];
  const e50 = ema(closes, 50)[k];
  const dx = adx(daily.map((d) => ({ t: 0, o: d.o, h: d.h, l: d.l, c: d.c, v: 0 })));
  const a = atr(daily.map((d) => ({ t: 0, o: d.o, h: d.h, l: d.l, c: d.c, v: 0 })), 14)[k];
  const A = dx.adx[k];
  const pdi = dx.plusDI[k];
  const mdi = dx.minusDI[k];
  if (e20 == null || e50 == null || a == null || A == null || pdi == null || mdi == null) {
    return { action: "WAIT", score: 0, components: zero, plan: null, reason: "Not enough daily history yet." };
  }
  const c = closes[k];
  let high20 = -Infinity;
  for (let j = k - 20; j < k; j++) high20 = Math.max(high20, daily[j].h);
  const qi = qqq.findIndex((q) => q.date === daily[k].date);
  const qRet = qi >= 20 ? qqq[qi].c / qqq[qi - 20].c - 1 : null;
  const rs = qRet != null ? c / closes[k - 20] - 1 - qRet : null;

  const trendOk = e20 > e50 && c > e20;
  const adxOk = A > 25 && pdi > mdi;
  const breakOk = c >= high20;
  const rsOk = rs != null && rs > 0.05;
  const plan: Plan = { direction: "long", entry: c, stop: c - SWING_STOP_ATR * a, target: c + SWING_TARGET_ATR * a, rr: SWING_TARGET_ATR / SWING_STOP_ATR };
  const components: Record<SwingComponent, number> = {
    trend: (e20 > e50 ? 15 : 0) + (c > e20 ? 15 : 0),
    adx: adxOk ? 25 : pdi > mdi ? Math.round(Math.min(A, 25)) : 0,
    breakout: breakOk ? 20 : Math.round(Math.max(0, 1 - (high20 - c) / (2 * a)) * 10),
    strength: rsOk ? 15 : rs != null && rs > 0 ? 7 : 0,
    reward: 10,
  };
  const score = Object.values(components).reduce((x, y) => x + y, 0);
  if (trendOk && adxOk && (breakOk || rsOk)) {
    const why = breakOk ? "a fresh 20 day high" : `${(rs! * 100).toFixed(0)} points stronger than QQQ over 20 days`;
    return { action: "BUY", score, components, plan, reason: `Daily uptrend with ADX ${A.toFixed(0)} and ${why}.` };
  }
  const reason = !trendOk
    ? "Daily trend is not up."
    : !adxOk
      ? `Trend is weak (ADX ${A.toFixed(0)}).`
      : "No 20 day high and not outpacing QQQ.";
  return { action: "WAIT", score, components, plan, reason };
}
