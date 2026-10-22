import { describe, expect, it } from "vitest";
import { atr, ema, rsi } from "@/lib/indicators";
import { buildSeries, decide, scoreAt, swingTrendSignal, trendAt, SWING_WEIGHTS } from "@/lib/engine";
import { chooseContract, parseOcc, type OptionQuote } from "@/lib/options";
import { runBacktest, runSwingBacktest } from "@/lib/backtest";
import type { Bar } from "@/lib/indicators";

// 2026-10-19 09:30 ET is 13:30 UTC.
const OPEN = Date.UTC(2026, 9, 19, 13, 30);
const DAY = 86_400_000;

function makeSession(dayIndex: number, start: number, drift: number, vol = 1000, n = 78): Bar[] {
  const out: Bar[] = [];
  let p = start;
  for (let k = 0; k < n; k++) {
    const t = OPEN + dayIndex * DAY + k * 5 * 60_000;
    const wiggle = Math.sin(k / 3) * 0.2;
    const o = p;
    const c = p + drift + wiggle;
    out.push({ t, o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c, v: vol });
    p = c;
  }
  return out;
}

function sessions(drifts: number[], lastVol = 1000) {
  // Mon..Fri of the same week keeps every bar inside regular weekday hours.
  let price = 100;
  const bars: Bar[] = [];
  drifts.forEach((d, i) => {
    const s = makeSession(i, price, d, i === drifts.length - 1 ? lastVol : 1000);
    bars.push(...s);
    price = s[s.length - 1].c;
  });
  return bars;
}

describe("indicators", () => {
  it("ema seeds with sma and converges", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[1]).toBeNull();
    expect(e[2]).toBeCloseTo(2);
    expect(e[3]).toBeCloseTo(3);
    expect(e[4]).toBeCloseTo(4);
  });
  it("rsi is 100 for only gains and bounded", () => {
    const up = Array.from({ length: 30 }, (_, i) => i);
    expect(rsi(up)[29]).toBe(100);
    const mixed = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
    for (const v of rsi(mixed)) {
      if (v == null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it("atr is positive", () => {
    const bars = makeSession(0, 100, 0.05);
    expect(atr(bars)[30]!).toBeGreaterThan(0);
  });
});

describe("engine", () => {
  it("builds session vwap and opening range", () => {
    const s = buildSeries(makeSession(0, 100, 0.05));
    expect(s.barOfSession[0]).toBe(0);
    expect(s.orHigh[1]).toBeNull();
    expect(s.orHigh[2]).not.toBeNull();
    expect(s.vwap[0]).toBeCloseTo((s.bars[0].h + s.bars[0].l + s.bars[0].c) / 3);
  });

  it("scores a strong uptrend as long and a downtrend as short", () => {
    const upBars = sessions([0.02, 0.02, 0.02, 0.02, 0.08], 2500);
    const s = buildSeries(upBars);
    const i = s.bars.length - 40;
    const r = scoreAt({ s, i, price: s.bars[i].c, dailyAtr: 20, spy: trendAt(s, s.bars[i].t), qqq: trendAt(s, s.bars[i].t) })!;
    expect(r.long.score).toBeGreaterThan(r.short.score);
    expect(r.long.plan.stop).toBeLessThan(r.long.plan.entry);
    expect(r.long.plan.target).toBeGreaterThan(r.long.plan.entry);

    const downBars = sessions([-0.02, -0.02, -0.02, -0.02, -0.08], 2500);
    const d = buildSeries(downBars);
    const j = d.bars.length - 40;
    const rd = scoreAt({ s: d, i: j, price: d.bars[j].c, dailyAtr: 20, spy: null, qqq: null })!;
    expect(rd.short.score).toBeGreaterThan(rd.long.score);
  });

  it("indicator values do not change when future bars are appended", () => {
    const bars = sessions([0.02, -0.01, 0.03, 0.01, 0.05]);
    const full = buildSeries(bars);
    const cut = buildSeries(bars.slice(0, 300));
    for (let i = 0; i < 300; i++) {
      expect(cut.ema21[i]).toEqual(full.ema21[i]);
      expect(cut.vwap[i]).toEqual(full.vwap[i]);
      expect(cut.rvol[i]).toEqual(full.rvol[i]);
      expect(cut.atr14[i]).toEqual(full.atr14[i]);
    }
  });

  it("gated decisions always wait", () => {
    const s = buildSeries(sessions([0.02, 0.02, 0.02, 0.02, 0.08], 2500));
    const i = s.bars.length - 40;
    const r = scoreAt({ s, i, price: s.bars[i].c, dailyAtr: 20, spy: null, qqq: null });
    expect(decide(r, { minScore: 0, minRR: 0 }, "Market closed.").action).toBe("WAIT");
    expect(decide(null, { minScore: 70, minRR: 2 }).action).toBe("WAIT");
  });
});

describe("options", () => {
  const plan = { direction: "long" as const, entry: 100, stop: 99.5, target: 103, rr: 3 };
  const base: OptionQuote = {
    symbol: "TEST261030C00100000",
    type: "call",
    strike: 100,
    expiration: "2026-10-30",
    bid: 1.0,
    ask: 1.05,
    delta: 0.5,
    gamma: 0.05,
    iv: 0.4,
    quoteTime: null,
    openInterest: 500,
  };
  const input = { equity: 5000, cash: 5000, riskPct: 1, maxPremiumPct: 25, minRR: 2, dteMin: 3, dteMax: 10, today: "2026-10-21", now: Date.now() };

  it("sizes within the risk budget", () => {
    const { pick } = chooseContract([base], plan, input);
    expect(pick).not.toBeNull();
    expect(pick!.plannedRisk).toBeLessThanOrEqual(50);
    expect(pick!.contracts).toBeGreaterThanOrEqual(1);
    expect(pick!.rr).toBeGreaterThanOrEqual(2);
  });

  it("rejects wide spreads, wrong type and out of window expirations", () => {
    expect(chooseContract([{ ...base, bid: 0.5 }], plan, input).pick).toBeNull();
    expect(chooseContract([{ ...base, type: "put" }], plan, input).pick).toBeNull();
    expect(chooseContract([{ ...base, expiration: "2026-10-22" }], plan, input).pick).toBeNull();
  });

  it("parses occ symbols", () => {
    expect(parseOcc("NVDA261030C00185000")).toEqual({ root: "NVDA", expiration: "2026-10-30", type: "call", strike: 185 });
    expect(parseOcc("nope")).toBeNull();
  });
});

describe("backtest", () => {
  it("runs and keeps accounting consistent", () => {
    const bars = sessions([0.02, 0.03, -0.04, 0.05, 0.06], 2000);
    const res = runBacktest(
      { TEST: bars },
      { TEST: [] },
      { spy: bars, qqq: bars },
      { startBalance: 5000, riskPct: 1, maxDailyLossPct: 3, maxPositions: 3, minRR: 2, minScore: 60, exitScore: 40, slippageBps: 5, feePerShare: 0 },
    );
    const sum = res.trades.reduce((a, t) => a + t.pnl, 0);
    expect(res.summary.endBalance).toBeCloseTo(5000 + sum);
    for (const t of res.trades) expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
  });
});

describe("swing trend", () => {
  // Business days only; a steady uptrend with a little noise.
  function dailySeries(n: number, drift: number, start = 100) {
    const out: { date: string; o: number; h: number; l: number; c: number }[] = [];
    let p = start;
    const d = new Date(Date.UTC(2025, 0, 2));
    while (out.length < n) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
        const o = p;
        const c = p * (1 + drift + Math.sin(out.length / 3) * 0.004);
        out.push({ date: d.toISOString().slice(0, 10), o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c });
        p = c;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }

  it("buys a strong daily uptrend with ATR based levels and waits in a downtrend", () => {
    const qqq = dailySeries(120, 0.0005);
    const up = swingTrendSignal(dailySeries(120, 0.006), qqq);
    expect(up.action).toBe("BUY");
    expect(up.plan!.stop).toBeLessThan(up.plan!.entry);
    expect(up.plan!.target).toBeGreaterThan(up.plan!.entry);
    expect(up.plan!.rr).toBeCloseTo(2);
    expect(Object.values(SWING_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(swingTrendSignal(dailySeries(120, -0.006), qqq).action).toBe("WAIT");
    expect(swingTrendSignal(dailySeries(30, 0.006), qqq).action).toBe("WAIT");
  });

  it("backtest trades do not change when future sessions are appended", () => {
    const qqq = dailySeries(260, 0.0005);
    const sym = dailySeries(260, 0.003);
    const full = runSwingBacktest({ X: sym }, qqq, { startBalance: 5000, riskPct: 1, maxPositions: 3, slippageBps: 5 });
    const cut = runSwingBacktest({ X: sym.slice(0, 200) }, qqq.slice(0, 200), { startBalance: 5000, riskPct: 1, maxPositions: 3, slippageBps: 5 });
    const cutoff = Date.parse(`${sym[190].date}T20:00:00Z`);
    const a = full.trades.filter((t) => t.exitTime < cutoff);
    const b = cut.trades.filter((t) => t.exitTime < cutoff);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
