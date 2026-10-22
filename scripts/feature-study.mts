// Feature edge screen on cached bars.
// Usage: npx tsx --conditions react-server scripts/feature-study.mts <bars5.json> <daily.json> [devFraction=0.6]
// bars5.json: { [symbol]: [t, o, h, l, c, v][] } regular session 5 minute bars. daily.json: { [symbol]: DailyBar[] }.
import { readFileSync } from "node:fs";
import { buildSeries, type DailyBar, type Series } from "../src/lib/engine";
import {
  adx,
  atrPercentile,
  dailyContext,
  donchianBreak,
  gapState,
  htfTrend,
  obvSlope,
  relativeStrength,
  rsi2,
  squeeze,
  vwapZ,
} from "../src/lib/features";
import { atr, ema, rsi, type Bar } from "../src/lib/indicators";

const [barsPath, dailyPath, fracArg] = process.argv.slice(2);
if (!barsPath || !dailyPath) throw new Error("usage: feature-study.mts <bars5.json> <daily.json> [devFraction]");
const DEV_FRACTION = Number(fracArg ?? 0.6);
const COST_BPS = 5;
const UNIVERSE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "MU", "SNDK", "WDC", "STX"];
const FIRST_BAR = 2; // decide at the close of the 9:40 bar or later
const LAST_BAR = 71; // last decision at the close of the 3:25 bar
const WARMUP_SESSIONS = 10;

const rawBars = JSON.parse(readFileSync(barsPath, "utf8")) as Record<string, number[][]>;
const rawDaily = JSON.parse(readFileSync(dailyPath, "utf8")) as Record<string, DailyBar[]>;
const toBars = (rows: number[][]): Bar[] => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

const qqq = buildSeries(toBars(rawBars.QQQ ?? []));
const allDates = [...new Set(qqq.session)].sort();
const usable = allDates.slice(WARMUP_SESSIONS);
const devDates = usable.slice(0, Math.floor(usable.length * DEV_FRACTION));
const devSet = new Set(devDates);
const thirds = [0, 1, 2].map((k) => new Set(devDates.slice(Math.floor((k * devDates.length) / 3), Math.floor(((k + 1) * devDates.length) / 3))));

type Horizon = "m30" | "m60" | "close";
const HORIZONS: Horizon[] = ["m30", "m60", "close"];

interface Obs {
  date: string;
  sym: string;
  gross: Record<Horizon, number>; // long return in ATR, before costs
  cost: number; // round trip cost in ATR
  f: Record<string, number | boolean | null>;
}

const obs: Obs[] = [];

for (const sym of UNIVERSE) {
  if (!rawBars[sym]?.length) continue;
  const s: Series = buildSeries(toBars(rawBars[sym]));
  const b = s.bars;
  const ctx = dailyContext(rawDaily[sym] ?? [], s.session);
  const ad = adx(b);
  const sq = squeeze(b);
  const z = vwapZ(b, s.session);
  const h15 = htfTrend(b, s.barOfSession, 3);
  const h60 = htfTrend(b, s.barOfSession, 12);
  const rs = relativeStrength(b, s.session, qqq.bars, qqq.session);
  const obv = obvSlope(b);
  const pct = atrPercentile(s.atr14);
  const r2 = rsi2(b);
  const don = donchianBreak(b);
  const gs = gapState(b, s.session, ctx);

  // Last bar index of each session for "to close" exits.
  const lastOf = new Map<string, number>();
  s.session.forEach((d, i) => lastOf.set(d, i));

  for (let i = 1; i < b.length - 1; i++) {
    const date = s.session[i];
    if (!devSet.has(date)) continue;
    const n = s.barOfSession[i];
    if (n < FIRST_BAR || n > LAST_BAR || s.session[i + 1] !== date) continue;
    const a = s.atr14[i];
    if (a == null || a <= 0) continue;
    const last = lastOf.get(date)!;
    const entry = b[i + 1].o;
    const exitAt = (k: number) => b[Math.min(i + k, last)].c;
    const c = ctx.get(date)!;
    const sqPrev = sq.on[i - 1];
    obs.push({
      date,
      sym,
      cost: (2 * COST_BPS * entry) / 10_000 / a,
      gross: { m30: (exitAt(6) - entry) / a, m60: (exitAt(12) - entry) / a, close: (b[last].c - entry) / a },
      f: {
        adx: ad.adx[i],
        pdi: ad.plusDI[i],
        mdi: ad.minusDI[i],
        sqOn: sq.on[i],
        sqRelease: sqPrev === true && sq.on[i] === false,
        aboveMid: sq.percentB[i] != null ? sq.percentB[i]! > 0.5 : null,
        bw: sq.bandwidth[i],
        z: z[i],
        h15: h15[i],
        h60: h60[i],
        rs: rs[i],
        obv: obv[i],
        pct: pct[i],
        r2: r2[i],
        don: don[i],
        tod: n,
        dTrend: c.trend,
        dAbove: c.aboveEma20,
        aboveVwap: b[i].c > s.vwap[i],
        pdh: c.prevHigh != null ? b[i].c > c.prevHigh : null,
        pdl: c.prevLow != null ? b[i].c < c.prevLow : null,
        inside: c.insideDay,
        nr7: c.nr7,
        gap: gs.gap[i],
        gapFilled: gs.filled[i],
        rvol: s.rvol[i],
      },
    });
  }
}

type Cond = (f: Obs["f"]) => boolean;
const num = (x: number | boolean | null) => (typeof x === "number" ? x : null);
const gt = (k: string, v: number): Cond => (f) => (num(f[k]) ?? -Infinity) > v;
const lt = (k: string, v: number): Cond => (f) => (num(f[k]) ?? Infinity) < v;
const is = (k: string, v: boolean | number): Cond => (f) => f[k] === v;
const and = (...cs: Cond[]): Cond => (f) => cs.every((c) => c(f));
const dailyUp = and(gt("dTrend", 0), is("dAbove", true));
const dailyDown = and(lt("dTrend", 0), is("dAbove", false));

// Buckets are fixed up front. Each is tested long and short over three horizons.
const BUCKETS: Record<string, Cond> = {
  "ADX>25 +DI lead": and(gt("adx", 25), (f) => (num(f.pdi) ?? 0) > (num(f.mdi) ?? 0)),
  "ADX>25 -DI lead": and(gt("adx", 25), (f) => (num(f.mdi) ?? 0) > (num(f.pdi) ?? 0)),
  "ADX<20": lt("adx", 20),
  "Squeeze on": is("sqOn", true),
  "Squeeze release up": and(is("sqRelease", true), is("aboveMid", true)),
  "Squeeze release down": and(is("sqRelease", true), is("aboveMid", false)),
  "VWAP z > 2": gt("z", 2),
  "VWAP z 1..2": and(gt("z", 1), (f) => (num(f.z) ?? 9) <= 2),
  "VWAP z < -2": lt("z", -2),
  "VWAP z -2..-1": and(lt("z", -1), (f) => (num(f.z) ?? -9) >= -2),
  "15m trend up": gt("h15", 0),
  "15m trend down": lt("h15", 0),
  "60m trend up": gt("h60", 0),
  "60m trend down": lt("h60", 0),
  "RS vs QQQ > +0.5%": gt("rs", 0.005),
  "RS vs QQQ < -0.5%": lt("rs", -0.005),
  "OBV slope > 0.5": gt("obv", 0.5),
  "OBV slope < -0.5": lt("obv", -0.5),
  "Time 9:40-10:25": (f) => (num(f.tod) ?? 0) <= 11,
  "Time 10:30-13:55": (f) => (num(f.tod) ?? 0) >= 12 && (num(f.tod) ?? 0) <= 53,
  "Time 14:00-15:25": (f) => (num(f.tod) ?? 0) >= 54,
  "ATR pct < 0.2": lt("pct", 0.2),
  "ATR pct > 0.8": gt("pct", 0.8),
  "RSI2 < 10": lt("r2", 10),
  "RSI2 > 90": gt("r2", 90),
  "Donchian 20 break up": is("don", 1),
  "Donchian 20 break down": is("don", -1),
  "Daily trend up": dailyUp,
  "Daily trend down": dailyDown,
  "Above prior day high": is("pdh", true),
  "Below prior day low": is("pdl", true),
  "Prior inside day": is("inside", true),
  "Prior NR7": is("nr7", true),
  "Gap up > 0.5 ATR unfilled": and(gt("gap", 0.5), is("gapFilled", false)),
  "Gap down > 0.5 ATR unfilled": and(lt("gap", -0.5), is("gapFilled", false)),
  "Gap up > 0.5 ATR filled": and(gt("gap", 0.5), is("gapFilled", true)),
  "Gap down > 0.5 ATR filled": and(lt("gap", -0.5), is("gapFilled", true)),
  // Pre-specified strategy hypotheses.
  "H1 trend pullback long": and(dailyUp, gt("h60", 0), gt("z", -1.5), lt("z", -0.5)),
  "H1 trend pullback short": and(dailyDown, lt("h60", 0), gt("z", 0.5), lt("z", 1.5)),
  "H2 RSI2 dip in daily uptrend": and(dailyUp, lt("r2", 10)),
  "H2 RSI2 pop in daily downtrend": and(dailyDown, gt("r2", 90)),
  "H3 PDH break, daily up, rvol>1.5": and(dailyUp, is("pdh", true), gt("rvol", 1.5)),
  "H3 PDL break, daily down, rvol>1.5": and(dailyDown, is("pdl", true), gt("rvol", 1.5)),
  "H4 gap and go up": and(gt("gap", 0.5), is("gapFilled", false), gt("rs", 0), (f) => (num(f.tod) ?? 99) <= 11),
  "H4 gap and go down": and(lt("gap", -0.5), is("gapFilled", false), lt("rs", 0), (f) => (num(f.tod) ?? 99) <= 11),
  "H5 squeeze release with 60m trend up": and(is("sqRelease", true), is("aboveMid", true), gt("h60", 0)),
  "H5 squeeze release with 60m trend down": and(is("sqRelease", true), is("aboveMid", false), lt("h60", 0)),
};

interface Stat {
  mean: number;
  gross: number;
  t: number;
  n: number;
  days: number;
  thirds: number[];
  symAgree: number;
}

/**
 * Net return stats. The mean is pooled over all observations; the t statistic uses a cluster robust
 * standard error by date, because bars within a day (across time and symbols) are strongly correlated.
 */
function stats(rows: Obs[], dir: 1 | -1, h: Horizon): Stat {
  const net = (o: Obs) => dir * o.gross[h] - o.cost;
  const n = Math.max(rows.length, 1);
  const mean = rows.reduce((a, o) => a + net(o), 0) / n;
  const gross = rows.reduce((a, o) => a + dir * o.gross[h], 0) / n;
  const byDay = new Map<string, number>();
  for (const o of rows) byDay.set(o.date, (byDay.get(o.date) ?? 0) + (net(o) - mean));
  const g = byDay.size;
  const clusterVar = [...byDay.values()].reduce((a, x) => a + x * x, 0) * (g / Math.max(g - 1, 1));
  const se = Math.sqrt(clusterVar) / n;
  const third = thirds.map((set) => {
    const r = rows.filter((o) => set.has(o.date));
    return r.length ? r.reduce((a, o) => a + net(o), 0) / r.length : NaN;
  });
  const syms = [...new Set(rows.map((o) => o.sym))];
  const agree = syms.filter((sy) => {
    const r = rows.filter((o) => o.sym === sy);
    const sm = r.reduce((a, o) => a + net(o), 0) / r.length;
    return Math.sign(sm) === Math.sign(mean);
  }).length;
  return { mean, gross, t: se > 0 ? mean / se : 0, n: rows.length, days: g, thirds: third, symAgree: syms.length ? agree / syms.length : 0 };
}

const results: { bucket: string; dir: "long" | "short"; h: Horizon; s: Stat }[] = [];
const base: Record<string, Stat> = {};
for (const h of HORIZONS) {
  base[`long ${h}`] = stats(obs, 1, h);
  base[`short ${h}`] = stats(obs, -1, h);
}
for (const [name, cond] of Object.entries(BUCKETS)) {
  const rows = obs.filter((o) => cond(o.f));
  if (rows.length < 50) continue;
  for (const h of HORIZONS) {
    results.push({ bucket: name, dir: "long", h, s: stats(rows, 1, h) });
    results.push({ bucket: name, dir: "short", h, s: stats(rows, -1, h) });
  }
}

const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "nan");
console.log(`dev sessions ${devDates[0]} to ${devDates.at(-1)} (${devDates.length}), observations ${obs.length}, tests ${results.length}`);
console.log("baseline (all bars, net):");
for (const [k, s] of Object.entries(base)) console.log(`  ${k.padEnd(12)} net ${fmt(s.mean)} gross ${fmt(s.gross)} t ${fmt(s.t, 2)}`);
console.log("\nbucket | dir | horizon | net mean ATR | gross ATR | t | n | days | net by third | symbol agreement");
const sorted = [...results].sort((a, b) => b.s.t - a.s.t);
for (const r of sorted) {
  const stable = r.s.thirds.every((x) => Math.sign(x) === Math.sign(r.s.mean));
  console.log(
    [r.bucket, r.dir, r.h, fmt(r.s.mean), fmt(r.s.gross), fmt(r.s.t, 2), r.s.n, r.s.days, r.s.thirds.map((x) => fmt(x, 2)).join("/") + (stable ? " stable" : ""), `${Math.round(r.s.symAgree * 100)}%`].join(" | "),
  );
}

/* ---------- Daily (swing) screen: decide at a session close, enter next open, hold 1, 3 or 5 sessions. ---------- */

type DH = "d1" | "d3" | "d5";
const DHS: DH[] = ["d1", "d3", "d5"];
interface DObs {
  date: string;
  sym: string;
  gross: Record<DH, number>;
  cost: number;
  f: Record<string, number | boolean | null>;
}

const toDailyBars = (d: DailyBar[]): Bar[] => d.map((x) => ({ t: Date.parse(`${x.date}T20:00:00Z`), o: x.o, h: x.h, l: x.l, c: x.c, v: 0 }));
const qd = [...(rawDaily.QQQ ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
const qqqClose = new Map(qd.map((d, i) => [d.date, { c: d.c, prev20: i >= 20 ? qd[i - 20].c : null }]));
const dailyDates = qd.map((d) => d.date);
const dDev = new Set(dailyDates.slice(60, 60 + Math.floor((dailyDates.length - 60) * DEV_FRACTION)));
const dDevList = [...dDev].sort();
const dThirds = [0, 1, 2].map((k) => new Set(dDevList.slice(Math.floor((k * dDevList.length) / 3), Math.floor(((k + 1) * dDevList.length) / 3))));
const dObs: DObs[] = [];

for (const sym of UNIVERSE) {
  const d = [...(rawDaily[sym] ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (d.length < 80) continue;
  const b = toDailyBars(d);
  const closes = d.map((x) => x.c);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const a14 = atr(b, 14);
  const r2d = rsi(closes, 2);
  const ad = adx(b);
  const sq = squeeze(b);
  const don = donchianBreak(b, 20);
  for (let i = 1; i < d.length - 5; i++) {
    if (!dDev.has(d[i].date)) continue;
    const a = a14[i];
    if (a == null || a <= 0 || e50[i] == null) continue;
    const entry = d[i + 1].o;
    const q = qqqClose.get(d[i].date);
    const rs20 = q?.prev20 != null && i >= 20 ? d[i].c / d[i - 20].c - q.c / q.prev20 : null;
    const ranges = d.slice(i - 6, i + 1).map((x) => x.h - x.l);
    dObs.push({
      date: d[i].date,
      sym,
      cost: (2 * COST_BPS * entry) / 10_000 / a,
      gross: { d1: (d[i + 1].c - entry) / a, d3: (d[i + 3].c - entry) / a, d5: (d[i + 5].c - entry) / a },
      f: {
        up: e20[i]! > e50[i]! && d[i].c > e20[i]!,
        down: e20[i]! < e50[i]! && d[i].c < e20[i]!,
        r2: r2d[i],
        don: don[i],
        nr7: ranges.length === 7 ? d[i].h - d[i].l <= Math.min(...ranges) : null,
        inside: d[i].h <= d[i - 1].h && d[i].l >= d[i - 1].l,
        rs20,
        adx: ad.adx[i],
        pdi: ad.plusDI[i],
        mdi: ad.minusDI[i],
        sqOn: sq.on[i],
        sqRelease: sq.on[i - 1] === true && sq.on[i] === false,
        aboveMid: sq.percentB[i] != null ? sq.percentB[i]! > 0.5 : null,
        gap: (d[i].o - d[i - 1].c) / a,
        dayRet: (d[i].c - d[i - 1].c) / a,
      },
    });
  }
}

const dUp = is("up", true);
const dDown = is("down", true);
const D_BUCKETS: Record<string, Cond> = {
  "Daily uptrend": dUp,
  "Daily downtrend": dDown,
  "RSI2 < 10": lt("r2", 10),
  "RSI2 > 90": gt("r2", 90),
  "20 day high close": is("don", 1),
  "20 day low close": is("don", -1),
  "NR7 day": is("nr7", true),
  "Inside day": is("inside", true),
  "RS20 vs QQQ > +5%": gt("rs20", 0.05),
  "RS20 vs QQQ < -5%": lt("rs20", -0.05),
  "ADX>25 +DI lead": and(gt("adx", 25), (f) => (num(f.pdi) ?? 0) > (num(f.mdi) ?? 0)),
  "ADX>25 -DI lead": and(gt("adx", 25), (f) => (num(f.mdi) ?? 0) > (num(f.pdi) ?? 0)),
  "Squeeze on": is("sqOn", true),
  "Down day > 1 ATR": lt("dayRet", -1),
  "Up day > 1 ATR": gt("dayRet", 1),
  "S1 RSI2 dip in uptrend": and(dUp, lt("r2", 10)),
  "S1 RSI2 pop in downtrend": and(dDown, gt("r2", 90)),
  "S2 20 day breakout in uptrend": and(dUp, is("don", 1)),
  "S2 20 day breakdown in downtrend": and(dDown, is("don", -1)),
  "S3 NR7 in uptrend": and(dUp, is("nr7", true)),
  "S4 strong RS in uptrend": and(dUp, gt("rs20", 0.05)),
  "S5 squeeze release up": and(is("sqRelease", true), is("aboveMid", true)),
  "S6 down day > 1 ATR in uptrend": and(dUp, lt("dayRet", -1)),
};

// Same day universe average forward return, used to strip market drift out of selection effects.
const dayAvg: Record<DH, Map<string, number>> = { d1: new Map(), d3: new Map(), d5: new Map() };
for (const h of DHS) {
  const sums = new Map<string, [number, number]>();
  for (const o of dObs) {
    const [a, c] = sums.get(o.date) ?? [0, 0];
    sums.set(o.date, [a + o.gross[h], c + 1]);
  }
  for (const [k, [a, c]] of sums) dayAvg[h].set(k, a / c);
}

function dStats(rows: DObs[], dir: 1 | -1, h: DH, excess = false): Stat {
  const net = (o: DObs) => (excess ? dir * (o.gross[h] - dayAvg[h].get(o.date)!) : dir * o.gross[h] - o.cost);
  const n = Math.max(rows.length, 1);
  const mean = rows.reduce((a, o) => a + net(o), 0) / n;
  const gross = rows.reduce((a, o) => a + dir * o.gross[h], 0) / n;
  // Cluster by entry week so overlapping multi day holds and same day symbols share a cluster.
  const byWeek = new Map<string, number>();
  for (const o of rows) {
    const wk = new Date(`${o.date}T12:00:00Z`);
    const key = String(Math.floor(wk.getTime() / (7 * 86_400_000)));
    byWeek.set(key, (byWeek.get(key) ?? 0) + (net(o) - mean));
  }
  const g = byWeek.size;
  const se = Math.sqrt([...byWeek.values()].reduce((a, x) => a + x * x, 0) * (g / Math.max(g - 1, 1))) / n;
  const third = dThirds.map((set) => {
    const r = rows.filter((o) => set.has(o.date));
    return r.length ? r.reduce((a, o) => a + net(o), 0) / r.length : NaN;
  });
  const syms = [...new Set(rows.map((o) => o.sym))];
  const agree = syms.filter((sy) => {
    const r = rows.filter((o) => o.sym === sy);
    return Math.sign(r.reduce((a, o) => a + net(o), 0)) === Math.sign(mean);
  }).length;
  return { mean, gross, t: se > 0 ? mean / se : 0, n: rows.length, days: g, thirds: third, symAgree: syms.length ? agree / syms.length : 0 };
}

const dResults: { bucket: string; dir: "long" | "short"; h: DH; s: Stat; x: Stat }[] = [];
for (const [name, cond] of Object.entries(D_BUCKETS)) {
  const rows = dObs.filter((o) => cond(o.f));
  if (rows.length < 30) continue;
  for (const h of DHS) {
    dResults.push({ bucket: name, dir: "long", h, s: dStats(rows, 1, h), x: dStats(rows, 1, h, true) });
    dResults.push({ bucket: name, dir: "short", h, s: dStats(rows, -1, h), x: dStats(rows, -1, h, true) });
  }
}
console.log(`\nDAILY dev ${dDevList[0]} to ${dDevList.at(-1)} (${dDevList.length} sessions), observations ${dObs.length}, tests ${dResults.length}`);
for (const h of DHS) {
  const b1 = dStats(dObs, 1, h);
  console.log(`  baseline long ${h} net ${fmt(b1.mean)} gross ${fmt(b1.gross)} t ${fmt(b1.t, 2)}`);
}
console.log("bucket | dir | horizon | net daily ATR | t | excess vs same day universe | excess t | n | weeks | excess by third | symbol agreement (excess)");
for (const r of [...dResults].sort((a, b) => b.x.t - a.x.t)) {
  const stable = r.x.thirds.every((x) => Math.sign(x) === Math.sign(r.x.mean));
  console.log(
    [r.bucket, r.dir, r.h, fmt(r.s.mean), fmt(r.s.t, 2), fmt(r.x.mean), fmt(r.x.t, 2), r.s.n, r.s.days, r.x.thirds.map((x) => fmt(x, 2)).join("/") + (stable ? " stable" : ""), `${Math.round(r.x.symAgree * 100)}%`].join(" | "),
  );
}
