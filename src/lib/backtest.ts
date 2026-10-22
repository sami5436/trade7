import { buildSeries, dailyAtr, decide, scoreAt, swingTrendSignal, trendAt, SWING_MAX_SESSIONS, type DailyBar, type Direction, type Series } from "./engine";
import type { Bar } from "./indicators";
import { etParts } from "./time";

export interface BacktestParams {
  startBalance: number;
  riskPct: number;
  maxDailyLossPct: number;
  maxPositions: number;
  minRR: number;
  minScore: number;
  exitScore: number;
  slippageBps: number;
  feePerShare: number;
}

export interface BacktestTrade {
  symbol: string;
  direction: Direction;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  shares: number;
  pnl: number;
  r: number;
  exitReason: "stop" | "target" | "signal" | "close";
  score: number;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  winRate: number;
  avgR: number;
  totalReturnPct: number;
  endBalance: number;
  maxDrawdownPct: number;
  profitFactor: number | null;
  from: string;
  to: string;
  sessions: number;
  symbols: string[];
}

export interface BacktestResult {
  summary: BacktestSummary;
  trades: BacktestTrade[];
  equity: { t: number; equity: number }[];
}

const ENTRY_FROM = 9 * 60 + 45; // first decision once the opening range bars have closed
const ENTRY_UNTIL = 15 * 60 + 30;
const FLAT_AT = 15 * 60 + 50;
const COOLDOWN_MS = 30 * 60_000;

interface Open {
  symbol: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  shares: number;
  risk: number;
  entryTime: number;
  score: number;
}

interface Pending {
  symbol: string;
  direction: Direction;
  stop: number;
  target: number;
  score: number;
}

/**
 * Event driven backtest on underlying shares. Decisions use bar closes and fill at the next bar open,
 * stops are checked before targets inside a bar, and every fill pays slippage plus fees.
 */
export function runBacktest(
  bars: Record<string, Bar[]>,
  daily: Record<string, DailyBar[]>,
  market: { spy: Bar[]; qqq: Bar[] },
  params: BacktestParams,
): BacktestResult {
  const symbols = Object.keys(bars);
  const series: Record<string, Series> = {};
  for (const sym of symbols) series[sym] = buildSeries(bars[sym]);
  const spy = buildSeries(market.spy);
  const qqq = buildSeries(market.qqq);

  const times = [...new Set(symbols.flatMap((s) => series[s].bars.map((b) => b.t)))].sort((a, b) => a - b);
  const slip = params.slippageBps / 10_000;
  const atrCache = new Map<string, number | null>();
  const getDailyAtr = (sym: string, date: string) => {
    const key = `${sym}:${date}`;
    if (!atrCache.has(key)) atrCache.set(key, dailyAtr(daily[sym] ?? [], date));
    return atrCache.get(key)!;
  };

  let cash = params.startBalance;
  let realized = 0;
  const open = new Map<string, Open>();
  let pending: Pending[] = [];
  let exitNext = new Set<string>();
  const trades: BacktestTrade[] = [];
  const equity: { t: number; equity: number }[] = [];
  const lastExit = new Map<string, number>();
  let day = "";
  let dayStart = cash;
  let halted = false;
  const sessions = new Set<string>();

  const close = (pos: Open, t: number, rawPrice: number, reason: BacktestTrade["exitReason"]) => {
    const long = pos.direction === "long";
    const fill = long ? rawPrice * (1 - slip) : rawPrice * (1 + slip);
    const gross = (long ? fill - pos.entry : pos.entry - fill) * pos.shares;
    const pnl = gross - params.feePerShare * pos.shares;
    cash += pos.entry * pos.shares + pnl;
    realized += pnl;
    trades.push({
      symbol: pos.symbol,
      direction: pos.direction,
      entryTime: pos.entryTime,
      exitTime: t,
      entry: pos.entry,
      exit: fill,
      shares: pos.shares,
      pnl,
      r: pos.risk > 0 ? pnl / pos.risk : 0,
      exitReason: reason,
      score: pos.score,
    });
    equity.push({ t, equity: params.startBalance + realized });
    open.delete(pos.symbol);
    lastExit.set(pos.symbol, t);
  };

  for (const t of times) {
    const { date, minutes } = etParts(t);
    sessions.add(date);
    if (date !== day) {
      day = date;
      dayStart = params.startBalance + realized;
      halted = false;
      pending = [];
    }

    // Fill entries decided on the previous bar at this bar's open.
    for (const p of pending) {
      const s = series[p.symbol];
      const i = s.index.get(t);
      if (i == null || open.has(p.symbol) || open.size >= params.maxPositions || halted) continue;
      const bar = s.bars[i];
      const long = p.direction === "long";
      const fill = long ? bar.o * (1 + slip) : bar.o * (1 - slip);
      const dist = Math.abs(fill - p.stop);
      if (long ? fill <= p.stop || fill >= p.target : fill >= p.stop || fill <= p.target) continue;
      const equityNow = params.startBalance + realized;
      const risk = (equityNow * params.riskPct) / 100;
      const shares = Math.floor((Math.min(risk / dist, cash / fill) * 1000)) / 1000;
      if (shares <= 0) continue;
      cash -= fill * shares + params.feePerShare * shares;
      open.set(p.symbol, {
        symbol: p.symbol,
        direction: p.direction,
        entry: fill,
        stop: p.stop,
        target: p.target,
        shares,
        risk: dist * shares,
        entryTime: t,
        score: p.score,
      });
    }
    pending = [];

    // Manage open positions on this bar.
    for (const pos of [...open.values()]) {
      const s = series[pos.symbol];
      const i = s.index.get(t);
      if (i == null) continue;
      const bar = s.bars[i];
      const long = pos.direction === "long";
      if (minutes >= FLAT_AT || exitNext.has(pos.symbol)) {
        close(pos, t, bar.o, minutes >= FLAT_AT ? "close" : "signal");
        continue;
      }
      if (long ? bar.l <= pos.stop : bar.h >= pos.stop) {
        close(pos, t, long ? Math.min(bar.o, pos.stop) : Math.max(bar.o, pos.stop), "stop");
        continue;
      }
      if (long ? bar.h >= pos.target : bar.l <= pos.target) {
        close(pos, t, long ? Math.max(bar.o, pos.target) : Math.min(bar.o, pos.target), "target");
        continue;
      }
    }

    if (!halted && params.startBalance + realized - dayStart <= -(dayStart * params.maxDailyLossPct) / 100) {
      halted = true;
      for (const pos of [...open.values()]) {
        const i = series[pos.symbol].index.get(t);
        if (i != null) close(pos, t, series[pos.symbol].bars[i].c, "stop");
      }
    }

    exitNext = new Set();

    // Decide at the close of this bar.
    const barEnd = minutes + 5;
    const candidates: Pending[] = [];
    for (const sym of symbols) {
      const s = series[sym];
      const i = s.index.get(t);
      if (i == null) continue;
      const result = scoreAt({
        s,
        i,
        price: s.bars[i].c,
        dailyAtr: getDailyAtr(sym, date),
        spy: trendAt(spy, t),
        qqq: trendAt(qqq, t),
      });
      const pos = open.get(sym);
      if (pos) {
        const side = result ? (pos.direction === "long" ? result.long : result.short) : null;
        const other = result ? (pos.direction === "long" ? result.short : result.long) : null;
        if (side && other && (side.score < params.exitScore || (other.score >= params.minScore && other.plan.rr >= params.minRR))) {
          exitNext.add(sym);
        }
        continue;
      }
      if (halted || barEnd < ENTRY_FROM || barEnd > ENTRY_UNTIL) continue;
      if (t - (lastExit.get(sym) ?? -Infinity) < COOLDOWN_MS) continue;
      const signal = decide(result, { minScore: params.minScore, minRR: params.minRR });
      if (signal.action === "WAIT" || !signal.plan) continue;
      candidates.push({ symbol: sym, direction: signal.plan.direction, stop: signal.plan.stop, target: signal.plan.target, score: signal.score });
    }
    candidates.sort((a, b) => b.score - a.score);
    pending = candidates.slice(0, Math.max(params.maxPositions - open.size, 0));
  }

  // Close anything still open at the last available price.
  for (const pos of [...open.values()]) {
    const s = series[pos.symbol];
    const last = s.bars[s.bars.length - 1];
    close(pos, last.t, last.c, "close");
  }

  return summarize(trades, equity, params.startBalance, [...sessions], symbols);
}

/**
 * Daily swing backtest on shares using swingTrendSignal: decide on each completed session, enter at the
 * next session open, stop before target inside a day, time exit at the close of the last allowed session.
 */
export function runSwingBacktest(
  daily: Record<string, DailyBar[]>,
  qqq: DailyBar[],
  params: Pick<BacktestParams, "startBalance" | "riskPct" | "maxPositions" | "slippageBps"> & { from?: string; to?: string },
): BacktestResult {
  const slip = params.slippageBps / 10_000;
  const symbols = Object.keys(daily);
  const index: Record<string, Map<string, number>> = {};
  for (const s of symbols) index[s] = new Map(daily[s].map((d, i) => [d.date, i]));
  const dates = [...new Set(symbols.flatMap((s) => daily[s].map((d) => d.date)))]
    .sort()
    .filter((d) => (!params.from || d >= params.from) && (!params.to || d < params.to));

  interface Pos { symbol: string; entry: number; stop: number; target: number; shares: number; risk: number; k0: number; t: number; score: number }
  const open = new Map<string, Pos>();
  let pending: { symbol: string; score: number; stopDist: number; targetDist: number }[] = [];
  let realized = 0;
  const trades: BacktestTrade[] = [];
  const equity: { t: number; equity: number }[] = [];
  const close = (p: Pos, raw: number, t: number, reason: BacktestTrade["exitReason"]) => {
    const fill = raw * (1 - slip);
    const pnl = (fill - p.entry) * p.shares;
    realized += pnl;
    trades.push({ symbol: p.symbol, direction: "long", entryTime: p.t, exitTime: t, entry: p.entry, exit: fill, shares: p.shares, pnl, r: pnl / p.risk, exitReason: reason, score: p.score });
    equity.push({ t, equity: params.startBalance + realized });
    open.delete(p.symbol);
  };

  for (const date of dates) {
    const t = Date.parse(`${date}T20:00:00Z`);
    for (const c of pending) {
      if (open.has(c.symbol) || open.size >= params.maxPositions) continue;
      const k = index[c.symbol].get(date);
      if (k == null) continue;
      const fill = daily[c.symbol][k].o * (1 + slip);
      const eq = params.startBalance + realized;
      const shares = Math.floor(((eq * params.riskPct) / 100 / c.stopDist) * 1000) / 1000;
      if (shares <= 0) continue;
      open.set(c.symbol, { symbol: c.symbol, entry: fill, stop: fill - c.stopDist, target: fill + c.targetDist, shares, risk: c.stopDist * shares, k0: k, t, score: c.score });
    }
    pending = [];
    for (const p of [...open.values()]) {
      const k = index[p.symbol].get(date);
      if (k == null) continue;
      const bar = daily[p.symbol][k];
      if (bar.l <= p.stop) close(p, Math.min(bar.o, p.stop), t, "stop");
      else if (bar.h >= p.target) close(p, Math.max(bar.o, p.target), t, "target");
      else if (k - p.k0 + 1 >= SWING_MAX_SESSIONS) close(p, bar.c, t, "close");
    }
    const qk = qqq.findIndex((q) => q.date === date);
    if (qk < 0) continue;
    const cands: typeof pending = [];
    for (const s of symbols) {
      if (open.has(s)) continue;
      const k = index[s].get(date);
      if (k == null) continue;
      const sig = swingTrendSignal(daily[s].slice(0, k + 1), qqq.slice(0, qk + 1));
      if (sig.action !== "BUY" || !sig.plan) continue;
      cands.push({ symbol: s, score: sig.score, stopDist: sig.plan.entry - sig.plan.stop, targetDist: sig.plan.target - sig.plan.entry });
    }
    cands.sort((a, b) => b.score - a.score);
    pending = cands;
  }
  for (const p of [...open.values()]) {
    const d = daily[p.symbol];
    const last = d[d.length - 1];
    close(p, last.c, Date.parse(`${last.date}T20:00:00Z`), "close");
  }
  return summarize(trades, equity, params.startBalance, dates, symbols);
}

function summarize(trades: BacktestTrade[], equity: { t: number; equity: number }[], startBalance: number, sessionList: string[], symbols: string[]): BacktestResult {
  const realized = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  let peak = startBalance;
  let maxDd = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.max(maxDd, (peak - p.equity) / peak);
  }
  const sortedSessions = [...sessionList].sort();
  const endBalance = startBalance + realized;
  return {
    summary: {
      trades: trades.length,
      wins: wins.length,
      winRate: trades.length ? wins.length / trades.length : 0,
      avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
      totalReturnPct: ((endBalance - startBalance) / startBalance) * 100,
      endBalance,
      maxDrawdownPct: maxDd * 100,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      from: sortedSessions[0] ?? "",
      to: sortedSessions[sortedSessions.length - 1] ?? "",
      sessions: sortedSessions.length,
      symbols,
    },
    trades,
    equity,
  };
}
