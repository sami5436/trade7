// Shared harness: loads cached data, precomputes causal features, and simulates strategy families in R units.
import { readFileSync } from "node:fs";
import { buildSeries, dailyAtr, scoreAt, trendAt, type DailyBar, type Series } from "@/lib/engine";
import { ema } from "@/lib/indicators";
import type { Bar } from "@/lib/indicators";
import { etParts } from "@/lib/time";
import { adx } from "@/lib/features";

export const DIR = process.env.T7_DATA ?? "scripts/tmp";
export const TRADE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "MU", "SNDK", "WDC", "STX"];
export const HOLDOUT_FROM = "2026-07-21";
const SLIP = 5 / 10_000;

export interface Feat {
  s: Series;
  minutes: Int16Array;
  dayIdx: Int32Array; // index into daily array of the session date
  longBase: Float32Array; // score without reward points, NaN if not ready
  shortBase: Float32Array;
  mkt: Int8Array; // +1 both SPY/QQQ up (above VWAP and EMA up), -1 both down, 0 mixed
  dAtr: Float32Array;
  dUp: Int8Array; // daily trend from prior closes: +1 close>EMA20>EMA50, -1 reverse, 0
}

export interface Data {
  feats: Record<string, Feat>;
  daily: Record<string, DailyBar[]>;
  dailyIndex: Record<string, Map<string, number>>;
  spyDaily: DailyBar[];
  sessions: string[];
}

export function load(): Data {
  const raw = JSON.parse(readFileSync(`${DIR}/bars5.json`, "utf8")) as Record<string, number[][]>;
  const daily = JSON.parse(readFileSync(`${DIR}/daily.json`, "utf8")) as Record<string, DailyBar[]>;
  const toBars = (rows: number[][]): Bar[] => rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  const spy = buildSeries(toBars(raw.SPY));
  const qqq = buildSeries(toBars(raw.QQQ));
  const dailyIndex: Record<string, Map<string, number>> = {};
  for (const [s, d] of Object.entries(daily)) dailyIndex[s] = new Map(d.map((x, i) => [x.date, i]));
  const feats: Record<string, Feat> = {};
  const sessions = new Set<string>();
  for (const sym of TRADE) {
    const s = buildSeries(toBars(raw[sym]));
    const n = s.bars.length;
    const d = daily[sym];
    const dc = d.map((x) => x.c);
    const e20 = ema(dc, 20);
    const e50 = ema(dc, 50);
    const f: Feat = {
      s,
      minutes: new Int16Array(n),
      dayIdx: new Int32Array(n),
      longBase: new Float32Array(n),
      shortBase: new Float32Array(n),
      mkt: new Int8Array(n),
      dAtr: new Float32Array(n),
      dUp: new Int8Array(n),
    };
    const atrCache = new Map<string, number | null>();
    for (let i = 0; i < n; i++) {
      const b = s.bars[i];
      const date = s.session[i];
      sessions.add(date);
      f.minutes[i] = etParts(b.t).minutes;
      const di = dailyIndex[sym].get(date) ?? -1;
      f.dayIdx[i] = di;
      if (!atrCache.has(date)) atrCache.set(date, dailyAtr(d, date));
      const da = atrCache.get(date);
      f.dAtr[i] = da ?? NaN;
      // Prior day EMAs (index di-1) only.
      const p = di - 1;
      if (p >= 0 && e20[p] != null && e50[p] != null) {
        const c = dc[p];
        f.dUp[i] = c > e20[p]! && e20[p]! > e50[p]! ? 1 : c < e20[p]! && e20[p]! < e50[p]! ? -1 : 0;
      }
      const ts = trendAt(spy, b.t);
      const tq = trendAt(qqq, b.t);
      const up = (t: typeof ts) => !!t && t.aboveVwap && t.emaUp;
      const dn = (t: typeof ts) => !!t && t.belowVwap && t.emaDown;
      f.mkt[i] = up(ts) && up(tq) ? 1 : dn(ts) && dn(tq) ? -1 : 0;
      const r = scoreAt({ s, i, price: b.c, dailyAtr: da ?? null, spy: ts, qqq: tq });
      f.longBase[i] = r ? r.long.score - r.long.components.reward : NaN;
      f.shortBase[i] = r ? r.short.score - r.short.components.reward : NaN;
    }
    feats[sym] = f;
  }
  return { feats, daily, dailyIndex, spyDaily: daily.SPY, sessions: [...sessions].sort() };
}

export interface Trade {
  sym: string;
  dir: 1 | -1;
  entryT: number;
  exitT: number;
  date: string;
  r: number;
}

export interface Stats {
  trades: number;
  winRate: number;
  avgR: number;
  sumR: number;
  pf: number;
  maxDdR: number;
}

export function stats(trades: Trade[]): Stats {
  const sorted = [...trades].sort((a, b) => a.exitT - b.exitT);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let win = 0;
  let gw = 0;
  let gl = 0;
  for (const t of sorted) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    if (t.r > 0) {
      win++;
      gw += t.r;
    } else gl -= t.r;
  }
  const n = trades.length;
  return { trades: n, winRate: n ? win / n : 0, avgR: n ? eq / n : 0, sumR: eq, pf: gl > 0 ? gw / gl : gw > 0 ? 99 : 0, maxDdR: dd };
}

const rewardPts = (rr: number) => (rr >= 3 ? 10 : rr >= 2.5 ? 8 : rr >= 2 ? 6 : 0);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/* ---------- Family M: current momentum score with tunable geometry and gates ---------- */
export interface MomentumCfg {
  family: "momentum";
  minScore: number;
  minRR: number;
  minStop: number; // in 5m ATR
  minT: number;
  maxT: number;
  fadeExit: boolean;
  marketGate: boolean;
  dailyGate: boolean;
  from: number; // minutes ET for decisions (bar end)
  until: number;
  maxPos: number;
}

export interface Plan {
  dir: 1 | -1;
  stop: number;
  target: number;
  score: number;
}

function momentumPlan(f: Feat, i: number, cfg: MomentumCfg): Plan | null {
  const s = f.s;
  const lb = f.longBase[i];
  if (Number.isNaN(lb)) return null;
  const sb = f.shortBase[i];
  const price = s.bars[i].c;
  const a = s.atr14[i]!;
  const orH = s.orHigh[i]!;
  const orL = s.orLow[i]!;
  const range = orH - orL;
  const best = (dir: 1 | -1) => {
    let stopDist: number;
    let tgtDist = clamp(range, cfg.minT * a, cfg.maxT * a);
    if (dir === 1) {
      const sup = [s.vwap[i], s.ema21[i]!, price > orH ? orH : -Infinity].filter((x) => x < price);
      const base = sup.length ? Math.max(...sup) - 0.25 * a : price - 1.5 * a;
      stopDist = clamp(price - base, cfg.minStop * a, 2.5 * a);
      const da = f.dAtr[i];
      if (!Number.isNaN(da)) tgtDist = Math.min(tgtDist, Math.min(s.dayLow[i], price) + 1.2 * da - price);
    } else {
      const res = [s.vwap[i], s.ema21[i]!, price < orL ? orL : Infinity].filter((x) => x > price);
      const base = res.length ? Math.min(...res) + 0.25 * a : price + 1.5 * a;
      stopDist = clamp(base - price, cfg.minStop * a, 2.5 * a);
      const da = f.dAtr[i];
      if (!Number.isNaN(da)) tgtDist = Math.min(tgtDist, price - (Math.max(s.dayHigh[i], price) - 1.2 * da));
    }
    const rr = tgtDist > 0 ? tgtDist / stopDist : 0;
    const score = (dir === 1 ? lb : sb) + rewardPts(rr);
    return { dir, stop: price - dir * stopDist, target: price + dir * tgtDist, score, rr };
  };
  const L = best(1);
  const S = best(-1);
  const p = L.score >= S.score ? L : S;
  if (p.score < cfg.minScore || p.rr < cfg.minRR) return null;
  if (cfg.marketGate && f.mkt[i] !== p.dir) return null;
  if (cfg.dailyGate && f.dUp[i] !== p.dir) return null;
  return { dir: p.dir, stop: p.stop, target: p.target, score: p.score };
}

/* ---------- Family P: trend pullback in the direction of the daily trend ---------- */
export interface PullbackCfg {
  family: "pullback";
  rMult: number; // target in R; 0 = hold to the flat time
  marketGate: boolean;
  touch: "vwap" | "ema21";
  from: number;
  until: number;
  maxPos: number;
  fadeExit: false;
}

function pullbackPlan(f: Feat, i: number, cfg: PullbackCfg): Plan | null {
  const s = f.s;
  if (i < 3 || s.barOfSession[i] < 3) return null;
  const dir = f.dUp[i] as 1 | -1 | 0;
  if (dir === 0) return null;
  if (cfg.marketGate && f.mkt[i] !== dir) return null;
  const a = s.atr14[i];
  const e9 = s.ema9[i];
  const e21 = s.ema21[i];
  if (a == null || e9 == null || e21 == null) return null;
  const b = s.bars[i];
  const level = cfg.touch === "vwap" ? s.vwap[i] : e21;
  if (dir === 1) {
    if (!(b.c > s.vwap[i] && e9 > e21)) return null;
    const lows = Math.min(s.bars[i - 1].l, s.bars[i - 2].l, b.l);
    if (!(lows <= level + 0.1 * a && b.c > e9 && b.c > b.o && s.bars[i - 1].c <= (s.ema9[i - 1] ?? Infinity))) return null;
    const stop = Math.min(lows - 0.25 * a, b.c - a);
    const risk = b.c - stop;
    return { dir, stop, target: cfg.rMult > 0 ? b.c + cfg.rMult * risk : Infinity, score: 0 };
  }
  if (!(b.c < s.vwap[i] && e9 < e21)) return null;
  const highs = Math.max(s.bars[i - 1].h, s.bars[i - 2].h, b.h);
  if (!(highs >= level - 0.1 * a && b.c < e9 && b.c < b.o && s.bars[i - 1].c >= (s.ema9[i - 1] ?? -Infinity))) return null;
  const stop = Math.max(highs + 0.25 * a, b.c + a);
  const risk = stop - b.c;
  return { dir, stop, target: cfg.rMult > 0 ? b.c - cfg.rMult * risk : -Infinity, score: 0 };
}

export type IntradayCfg = MomentumCfg | PullbackCfg;
const FLAT = 15 * 60 + 50;

/** Intraday simulation over sessions in [from, to). Fixed 1R risk per trade, no compounding. */
export function simIntraday(d: Data, cfg: IntradayCfg, from: string, to: string, exitScore = 40): Trade[] {
  const trades: Trade[] = [];
  // Merge bar times across symbols per session.
  const syms = Object.keys(d.feats);
  const ptr: Record<string, number> = {};
  for (const sym of syms) {
    const sess = d.feats[sym].s.session;
    let lo = 0;
    let hi = sess.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sess[m] < from) lo = m + 1;
      else hi = m;
    }
    ptr[sym] = lo;
  }
  interface Pos { sym: string; dir: 1 | -1; entry: number; stop: number; target: number; risk: number; t: number; date: string }
  const open = new Map<string, Pos>();
  let pending: { sym: string; plan: Plan }[] = [];
  const exitNext = new Set<string>();
  const lastExit = new Map<string, number>();
  let day = "";
  let dayR = 0;
  let halted = false;

  const close = (p: Pos, t: number, px: number) => {
    const fill = p.dir === 1 ? px * (1 - SLIP) : px * (1 + SLIP);
    const r = ((fill - p.entry) * p.dir) / p.risk;
    trades.push({ sym: p.sym, dir: p.dir, entryT: p.t, exitT: t, date: p.date, r });
    dayR += r;
    open.delete(p.sym);
    lastExit.set(p.sym, t);
  };

  for (;;) {
    // next timestamp
    let t = Infinity;
    for (const sym of syms) {
      const f = d.feats[sym];
      const k = ptr[sym];
      if (k < f.s.bars.length && f.s.session[k] < to) t = Math.min(t, f.s.bars[k].t);
    }
    if (t === Infinity) break;
    const { date, minutes } = etParts(t);
    if (date !== day) {
      day = date;
      dayR = 0;
      halted = false;
      pending = [];
      exitNext.clear();
    }
    const idx: Record<string, number> = {};
    for (const sym of syms) {
      const f = d.feats[sym];
      if (ptr[sym] < f.s.bars.length && f.s.bars[ptr[sym]].t === t) idx[sym] = ptr[sym]++;
    }
    // fills at open
    for (const { sym, plan } of pending) {
      const i = idx[sym];
      if (i == null || open.has(sym) || open.size >= cfg.maxPos || halted) continue;
      const o = d.feats[sym].s.bars[i].o;
      const fill = plan.dir === 1 ? o * (1 + SLIP) : o * (1 - SLIP);
      if ((fill - plan.stop) * plan.dir <= 0 || (plan.target - fill) * plan.dir <= 0) continue;
      open.set(sym, { sym, dir: plan.dir, entry: fill, stop: plan.stop, target: plan.target, risk: Math.abs(fill - plan.stop), t, date });
    }
    pending = [];
    for (const p of [...open.values()]) {
      const i = idx[p.sym];
      if (i == null) continue;
      const b = d.feats[p.sym].s.bars[i];
      if (minutes >= FLAT || exitNext.has(p.sym)) {
        close(p, t, b.o);
        continue;
      }
      if (p.dir === 1 ? b.l <= p.stop : b.h >= p.stop) {
        close(p, t, p.dir === 1 ? Math.min(b.o, p.stop) : Math.max(b.o, p.stop));
        continue;
      }
      if (p.dir === 1 ? b.h >= p.target : b.l <= p.target) close(p, t, p.dir === 1 ? Math.max(b.o, p.target) : Math.min(b.o, p.target));
    }
    exitNext.clear();
    if (!halted && dayR <= -3) {
      halted = true;
      for (const p of [...open.values()]) {
        const i = idx[p.sym];
        if (i != null) close(p, t, d.feats[p.sym].s.bars[i].c);
      }
    }
    const barEnd = minutes + 5;
    const cands: { sym: string; plan: Plan }[] = [];
    for (const sym of syms) {
      const i = idx[sym];
      if (i == null) continue;
      const f = d.feats[sym];
      const pos = open.get(sym);
      if (pos) {
        if (cfg.fadeExit) {
          const own = pos.dir === 1 ? f.longBase[i] : f.shortBase[i];
          if (!Number.isNaN(own) && own + 6 < exitScore) exitNext.add(sym);
        }
        continue;
      }
      if (halted || barEnd < cfg.from || barEnd > cfg.until) continue;
      if (t - (lastExit.get(sym) ?? -Infinity) < 30 * 60_000) continue;
      const plan = cfg.family === "momentum" ? momentumPlan(f, i, cfg) : pullbackPlan(f, i, cfg);
      if (plan) cands.push({ sym, plan });
    }
    cands.sort((a, b) => b.plan.score - a.plan.score);
    pending = cands.slice(0, Math.max(cfg.maxPos - open.size, 0));
  }
  return trades;
}

/* ---------- Family S: daily swing trend following ---------- */
export interface SwingCfg {
  family: "swing";
  entry: "breakout20" | "breakout55" | "trend" | "always" | "adxTrend" | "adxTrendCore" | "adxOnly";
  stopAtr: number;
  targetAtr: number; // 0 = none
  maxDays: number;
  marketGate: boolean;
  shorts: boolean;
  maxPos: number;
}

/** Daily swing: decide at a session's close, fill next session open, stops before targets, time stop at close. */
export function simSwing(d: Data, cfg: SwingCfg, from: string, to: string): Trade[] {
  const trades: Trade[] = [];
  const spy = d.spyDaily;
  const spyIdx = d.dailyIndex.SPY;
  const spyC = spy.map((x) => x.c);
  const spyE50 = ema(spyC, 50);
  const per: Record<string, { c: number[]; e20: (number | null)[]; e50: (number | null)[]; atr: (number | null)[]; adx: ReturnType<typeof adx> }> = {};
  for (const sym of TRADE) {
    const dd = d.daily[sym];
    const c = dd.map((x) => x.c);
    const atrs: (number | null)[] = dd.map((_, k) => dailyAtr(dd, dd[k].date + "~")); // includes day k (decision at its close)
    per[sym] = { c, e20: ema(c, 20), e50: ema(c, 50), atr: atrs, adx: adx(dd.map((x) => ({ t: 0, o: x.o, h: x.h, l: x.l, c: x.c, v: 0 }))) };
  }
  const qqq = d.daily.QQQ;
  const qqqIdx = d.dailyIndex.QQQ;
  const dates = spy.map((x) => x.date).filter((x) => x >= from && x < to);
  interface Pos { sym: string; dir: 1 | -1; entry: number; stop: number; target: number; risk: number; k0: number; date: string }
  const open = new Map<string, Pos>();
  let pending: { sym: string; dir: 1 | -1; strength: number }[] = [];
  const close = (p: Pos, px: number, date: string) => {
    const fill = p.dir === 1 ? px * (1 - SLIP) : px * (1 + SLIP);
    trades.push({ sym: p.sym, dir: p.dir, entryT: Date.parse(p.date), exitT: Date.parse(date), date: p.date, r: ((fill - p.entry) * p.dir) / p.risk });
    open.delete(p.sym);
  };
  for (const date of dates) {
    // entries at open
    for (const c of pending) {
      if (open.has(c.sym) || open.size >= cfg.maxPos) continue;
      const k = d.dailyIndex[c.sym].get(date);
      if (k == null) continue;
      const bar = d.daily[c.sym][k];
      const a = per[c.sym].atr[k - 1];
      if (a == null) continue;
      const fill = c.dir === 1 ? bar.o * (1 + SLIP) : bar.o * (1 - SLIP);
      const stop = fill - c.dir * cfg.stopAtr * a;
      const target = cfg.targetAtr > 0 ? fill + c.dir * cfg.targetAtr * a : c.dir * Infinity;
      open.set(c.sym, { sym: c.sym, dir: c.dir, entry: fill, stop, target, risk: cfg.stopAtr * a, k0: k, date });
    }
    pending = [];
    // manage
    for (const p of [...open.values()]) {
      const k = d.dailyIndex[p.sym].get(date);
      if (k == null) continue;
      const bar = d.daily[p.sym][k];
      if (p.dir === 1 ? bar.l <= p.stop : bar.h >= p.stop) {
        close(p, p.dir === 1 ? Math.min(bar.o, p.stop) : Math.max(bar.o, p.stop), date);
        continue;
      }
      if (p.dir === 1 ? bar.h >= p.target : bar.l <= p.target) {
        close(p, p.dir === 1 ? Math.max(bar.o, p.target) : Math.min(bar.o, p.target), date);
        continue;
      }
      if (k - p.k0 + 1 >= cfg.maxDays) close(p, bar.c, date);
    }
    // decide at close
    const si = spyIdx.get(date);
    const mkt = si != null && spyE50[si] != null ? (spyC[si] > spyE50[si]! ? 1 : -1) : 0;
    const cands: typeof pending = [];
    for (const sym of TRADE) {
      if (open.has(sym)) continue;
      const k = d.dailyIndex[sym].get(date);
      if (k == null || k < 56) continue;
      const P = per[sym];
      const c = P.c[k];
      const e20 = P.e20[k];
      const e50 = P.e50[k];
      const a = P.atr[k];
      if (e20 == null || e50 == null || a == null) continue;
      const dd = d.daily[sym];
      let dir: 0 | 1 | -1 = 0;
      if (cfg.entry === "always") {
        // Benchmark: be long whenever a slot is free, ignoring any signal.
        dir = 1;
      } else if (cfg.entry === "adxTrend" || cfg.entry === "adxTrendCore" || cfg.entry === "adxOnly") {
        // Pre-registered long only hypotheses from the indicator screen.
        const A = P.adx.adx[k];
        const pdi = P.adx.plusDI[k];
        const mdi = P.adx.minusDI[k];
        const adxOk = A != null && pdi != null && mdi != null && A > 25 && pdi > mdi;
        const trendOk = e20 > e50 && c > e20;
        let breakOk = false;
        if (cfg.entry === "adxTrend") {
          let hh = -Infinity;
          for (let j = k - 20; j < k; j++) hh = Math.max(hh, dd[j].h);
          const qk = qqqIdx.get(dd[k].date);
          const q20 = qk != null && qk >= 20 ? qqq[qk].c / qqq[qk - 20].c - 1 : null;
          const rs = q20 != null ? c / P.c[k - 20] - 1 - q20 : -Infinity;
          breakOk = c >= hh || rs > 0.05;
        }
        const ok = cfg.entry === "adxOnly" ? adxOk : cfg.entry === "adxTrendCore" ? adxOk && trendOk : adxOk && trendOk && breakOk;
        if (ok) dir = 1;
      } else if (cfg.entry === "trend") {
        // fresh cross of close above EMA20 while EMA20 > EMA50
        const prev = P.c[k - 1];
        const pe20 = P.e20[k - 1]!;
        if (e20 > e50 && c > e20 && prev <= pe20) dir = 1;
        else if (e20 < e50 && c < e20 && prev >= pe20) dir = -1;
      } else {
        const n = cfg.entry === "breakout20" ? 20 : 55;
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = k - n; j < k; j++) {
          hh = Math.max(hh, dd[j].h);
          ll = Math.min(ll, dd[j].l);
        }
        if (c > hh && c > e50) dir = 1;
        else if (c < ll && c < e50) dir = -1;
      }
      if (dir === 0 || (dir === -1 && !cfg.shorts)) continue;
      if (cfg.marketGate && mkt !== dir) continue;
      cands.push({ sym, dir, strength: Math.abs(c - e20) / a });
    }
    if (cfg.entry === "always") {
      // Deterministic shuffle so the benchmark is not biased toward any symbol.
      let seed = Date.parse(date) / 86_400_000;
      for (const c of cands) c.strength = ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    }
    cands.sort((a, b) => a.strength - b.strength); // least extended first
    pending = cands;
  }
  // close leftovers at last close in range
  for (const p of [...open.values()]) {
    const dd = d.daily[p.sym];
    const last = [...dd].reverse().find((x) => x.date < to);
    if (last) close(p, last.c, last.date);
  }
  return trades;
}

export function monthsAdd(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function spyReturn(d: Data, from: string, to: string): number {
  const s = d.spyDaily.filter((x) => x.date >= from && x.date < to);
  return s.length ? (s[s.length - 1].c / s[0].o - 1) * 100 : 0;
}
