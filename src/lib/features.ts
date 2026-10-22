import type { DailyBar } from "./engine";
import { atr, ema, rsi, type Bar, type Num } from "./indicators";

/*
 * Extra causal features. Every array is aligned to the input bars and the value at index i
 * only uses bars 0..i (and daily bars from sessions strictly before bar i's session).
 */

/** Wilder ADX with +DI and -DI. */
export function adx(bars: Bar[], period = 14): { adx: Num[]; plusDI: Num[]; minusDI: Num[] } {
  const n = bars.length;
  const out = { adx: new Array<Num>(n).fill(null), plusDI: new Array<Num>(n).fill(null), minusDI: new Array<Num>(n).fill(null) };
  if (n <= period * 2) return out;
  let trS = 0;
  let pS = 0;
  let mS = 0;
  let dxSum = 0;
  let adxPrev = 0;
  for (let i = 1; i < n; i++) {
    const b = bars[i];
    const p = bars[i - 1];
    const up = b.h - p.h;
    const down = p.l - b.l;
    const pdm = up > down && up > 0 ? up : 0;
    const mdm = down > up && down > 0 ? down : 0;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    if (i <= period) {
      trS += tr;
      pS += pdm;
      mS += mdm;
      if (i < period) continue;
    } else {
      trS = trS - trS / period + tr;
      pS = pS - pS / period + pdm;
      mS = mS - mS / period + mdm;
    }
    const pdi = trS > 0 ? (100 * pS) / trS : 0;
    const mdi = trS > 0 ? (100 * mS) / trS : 0;
    out.plusDI[i] = pdi;
    out.minusDI[i] = mdi;
    const dx = pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
    const k = i - period; // number of DX values before this one
    if (k < period - 1) {
      dxSum += dx;
    } else if (k === period - 1) {
      dxSum += dx;
      adxPrev = dxSum / period;
      out.adx[i] = adxPrev;
    } else {
      adxPrev = (adxPrev * (period - 1) + dx) / period;
      out.adx[i] = adxPrev;
    }
  }
  return out;
}

function rollingMeanStd(values: number[], period: number): { mean: Num[]; std: Num[] } {
  const mean: Num[] = new Array(values.length).fill(null);
  const std: Num[] = new Array(values.length).fill(null);
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    s2 += values[i] * values[i];
    if (i >= period) {
      s -= values[i - period];
      s2 -= values[i - period] * values[i - period];
    }
    if (i >= period - 1) {
      const m = s / period;
      mean[i] = m;
      std[i] = Math.sqrt(Math.max(s2 / period - m * m, 0));
    }
  }
  return { mean, std };
}

/** Bollinger bandwidth, %B and the TTM style squeeze (Bollinger bands inside Keltner channels). */
export function squeeze(bars: Bar[], period = 20, bbMult = 2, kcMult = 1.5) {
  const closes = bars.map((b) => b.c);
  const { mean, std } = rollingMeanStd(closes, period);
  const mid = ema(closes, period);
  const a = atr(bars, period);
  const bandwidth: Num[] = [];
  const percentB: Num[] = [];
  const on: (boolean | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    const m = mean[i];
    const sd = std[i];
    const k = mid[i];
    const r = a[i];
    if (m == null || sd == null || k == null || r == null) {
      bandwidth.push(null);
      percentB.push(null);
      on.push(null);
      continue;
    }
    bandwidth.push(m > 0 ? (4 * bbMult * sd) / (2 * m) : null);
    percentB.push(sd > 0 ? (closes[i] - (m - bbMult * sd)) / (2 * bbMult * sd) : 0.5);
    on.push(m + bbMult * sd < k + kcMult * r && m - bbMult * sd > k - kcMult * r);
  }
  return { bandwidth, percentB, on };
}

/** Session VWAP z score: distance from VWAP in volume weighted standard deviations. */
export function vwapZ(bars: Bar[], session: string[]): Num[] {
  const out: Num[] = [];
  let pv = 0;
  let pv2 = 0;
  let v = 0;
  let cur = "";
  bars.forEach((b, i) => {
    if (session[i] !== cur) {
      cur = session[i];
      pv = 0;
      pv2 = 0;
      v = 0;
    }
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v;
    pv2 += tp * tp * b.v;
    v += b.v;
    if (v <= 0) return out.push(null);
    const vw = pv / v;
    const sd = Math.sqrt(Math.max(pv2 / v - vw * vw, 0));
    out.push(sd > 0 ? (b.c - vw) / sd : null);
  });
  return out;
}

/**
 * Higher timeframe EMA trend from resampled bars. Bar i only sees higher timeframe bars that have
 * fully closed by the end of bar i (groups never span sessions).
 */
const LAST_BAR = 77;

export function htfTrend(bars: Bar[], barOfSession: number[], group: number, fast = 9, slow = 21): Num[] {
  const closes: number[] = [];
  const known: number[] = []; // number of completed HTF closes known at each bar
  bars.forEach((b, i) => {
    // The 3:55 PM bar always ends the session, which is known from the clock, not from later bars.
    if ((barOfSession[i] + 1) % group === 0 || barOfSession[i] === LAST_BAR) closes.push(b.c);
    known.push(closes.length);
  });
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  return bars.map((b, i) => {
    const k = known[i] - 1;
    if (k < 0 || f[k] == null || s[k] == null) return null;
    return (f[k]! - s[k]!) / b.c;
  });
}

/** Return since the session open minus the same for a benchmark aligned by timestamp. */
export function relativeStrength(bars: Bar[], session: string[], bench: Bar[], benchSession: string[]): Num[] {
  const benchOpen = new Map<string, number>();
  const benchClose = new Map<number, number>();
  bench.forEach((b, i) => {
    if (!benchOpen.has(benchSession[i])) benchOpen.set(benchSession[i], b.o);
    benchClose.set(b.t, b.c);
  });
  let open = 0;
  let cur = "";
  return bars.map((b, i) => {
    if (session[i] !== cur) {
      cur = session[i];
      open = b.o;
    }
    const bo = benchOpen.get(session[i]);
    const bc = benchClose.get(b.t);
    if (bo == null || bc == null || open <= 0) return null;
    return b.c / open - 1 - (bc / bo - 1);
  });
}

/** On balance volume slope over `period` bars, normalized by average volume. */
export function obvSlope(bars: Bar[], period = 12): Num[] {
  let obv = 0;
  const series: number[] = [];
  bars.forEach((b, i) => {
    if (i > 0) obv += b.c > bars[i - 1].c ? b.v : b.c < bars[i - 1].c ? -b.v : 0;
    series.push(obv);
  });
  const vols = rollingMeanStd(
    bars.map((b) => b.v),
    period,
  ).mean;
  return series.map((x, i) => (i >= period && vols[i] ? (x - series[i - period]) / (vols[i]! * period) : null));
}

/** Percentile rank of the current ATR within the trailing `lookback` ATR values. */
export function atrPercentile(atrValues: Num[], lookback = 390): Num[] {
  return atrValues.map((a, i) => {
    if (a == null || i < lookback) return null;
    let below = 0;
    let count = 0;
    for (let j = i - lookback; j < i; j++) {
      const x = atrValues[j];
      if (x == null) continue;
      count++;
      if (x < a) below++;
    }
    return count ? below / count : null;
  });
}

export function rsi2(bars: Bar[]): Num[] {
  return rsi(
    bars.map((b) => b.c),
    2,
  );
}

/** Donchian position: 1 when the close exceeds the prior `period` bar high, -1 below the low, else 0. */
export function donchianBreak(bars: Bar[], period = 20): Num[] {
  return bars.map((b, i) => {
    if (i < period) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      hi = Math.max(hi, bars[j].h);
      lo = Math.min(lo, bars[j].l);
    }
    return b.c > hi ? 1 : b.c < lo ? -1 : 0;
  });
}

export interface DailyContext {
  /** EMA20 minus EMA50 of daily closes before today, as a fraction of the last close. */
  trend: number | null;
  /** Prior close above its 20 day EMA. */
  aboveEma20: boolean | null;
  prevHigh: number | null;
  prevLow: number | null;
  prevClose: number | null;
  dailyAtr: number | null;
  /** Prior session was an inside day. */
  insideDay: boolean | null;
  /** Prior session had the narrowest range of the last 7. */
  nr7: boolean | null;
}

/** Daily context for each session date using only daily bars strictly before that date. */
export function dailyContext(daily: DailyBar[], dates: string[]): Map<string, DailyContext> {
  const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1));
  const closes = sorted.map((d) => d.c);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const a14 = atr(
    sorted.map((d) => ({ t: 0, o: d.o, h: d.h, l: d.l, c: d.c, v: 0 })),
    14,
  );
  const out = new Map<string, DailyContext>();
  let k = -1;
  for (const date of [...new Set(dates)].sort()) {
    while (k + 1 < sorted.length && sorted[k + 1].date < date) k++;
    if (k < 0) {
      out.set(date, { trend: null, aboveEma20: null, prevHigh: null, prevLow: null, prevClose: null, dailyAtr: null, insideDay: null, nr7: null });
      continue;
    }
    const d = sorted[k];
    const ranges = sorted.slice(Math.max(0, k - 6), k + 1).map((x) => x.h - x.l);
    out.set(date, {
      trend: e20[k] != null && e50[k] != null ? (e20[k]! - e50[k]!) / d.c : null,
      aboveEma20: e20[k] != null ? d.c > e20[k]! : null,
      prevHigh: d.h,
      prevLow: d.l,
      prevClose: d.c,
      dailyAtr: a14[k] ?? null,
      insideDay: k > 0 ? d.h <= sorted[k - 1].h && d.l >= sorted[k - 1].l : null,
      nr7: ranges.length === 7 ? d.h - d.l <= Math.min(...ranges) : null,
    });
  }
  return out;
}

/** Opening gap in daily ATR units and whether price has traded back to the prior close yet today. */
export function gapState(bars: Bar[], session: string[], ctx: Map<string, DailyContext>): { gap: Num[]; filled: (boolean | null)[] } {
  const gap: Num[] = [];
  const filled: (boolean | null)[] = [];
  let cur = "";
  let g: number | null = null;
  let done = false;
  bars.forEach((b, i) => {
    const c = ctx.get(session[i]);
    if (session[i] !== cur) {
      cur = session[i];
      g = c?.prevClose != null && c.dailyAtr ? (b.o - c.prevClose) / c.dailyAtr : null;
      done = false;
    }
    if (c?.prevClose != null && b.l <= c.prevClose && b.h >= c.prevClose) done = true;
    gap.push(g);
    filled.push(g == null ? null : done);
  });
  return { gap, filled };
}
