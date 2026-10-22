import { describe, expect, it } from "vitest";
import { buildSeries, type DailyBar } from "@/lib/engine";
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
} from "@/lib/features";
import { atr, type Bar } from "@/lib/indicators";

// 2026-10-19 09:30 ET is 13:30 UTC; five weekdays keep all bars inside regular hours.
const OPEN = Date.UTC(2026, 9, 19, 13, 30);
const DAY = 86_400_000;

function bars(days = 5, drift = 0.03): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < 78; k++) {
      const o = p;
      const c = p + drift + Math.sin((d * 78 + k) / 4) * 0.3;
      out.push({ t: OPEN + d * DAY + k * 5 * 60_000, o, h: Math.max(o, c) + 0.15, l: Math.min(o, c) - 0.15, c, v: 1000 + ((k * 37) % 500) });
      p = c;
    }
  }
  return out;
}

const daily: DailyBar[] = Array.from({ length: 80 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 6, 1) + i * DAY).toISOString().slice(0, 10);
  const c = 90 + i * 0.1 + Math.sin(i) * 2;
  return { date: d, o: c - 0.5, h: c + 1.5, l: c - 1.5, c };
});

function all(b: Bar[], qqq: Bar[]) {
  const s = buildSeries(b);
  const q = buildSeries(qqq);
  const ctx = dailyContext(daily, s.session);
  const sq = squeeze(s.bars);
  const ad = adx(s.bars);
  const gs = gapState(s.bars, s.session, ctx);
  return {
    adx: ad.adx,
    pdi: ad.plusDI,
    bw: sq.bandwidth,
    sqOn: sq.on,
    z: vwapZ(s.bars, s.session),
    h15: htfTrend(s.bars, s.barOfSession, 3),
    h60: htfTrend(s.bars, s.barOfSession, 12, 3, 6),
    rs: relativeStrength(s.bars, s.session, q.bars, q.session),
    obv: obvSlope(s.bars),
    pct: atrPercentile(atr(s.bars, 14), 100),
    r2: rsi2(s.bars),
    don: donchianBreak(s.bars),
    gap: gs.gap,
    filled: gs.filled,
  };
}

describe("features", () => {
  it("never change past values when future bars are appended", () => {
    const b = bars(5);
    const q = bars(5, -0.01);
    const full = all(b, q);
    for (const cut of [100, 200, 301]) {
      const part = all(b.slice(0, cut), q.slice(0, cut));
      for (const key of Object.keys(full) as (keyof typeof full)[]) {
        for (let i = 0; i < cut; i++) expect(part[key][i], `${key}[${i}] cut ${cut}`).toEqual(full[key][i]);
      }
    }
  });

  it("adx is bounded and +DI leads in an uptrend", () => {
    const up = bars(5, 0.08);
    const r = adx(up);
    const last = up.length - 1;
    expect(r.adx[last]!).toBeGreaterThan(0);
    expect(r.adx[last]!).toBeLessThanOrEqual(100);
    expect(r.plusDI[last]!).toBeGreaterThan(r.minusDI[last]!);
  });

  it("daily context only uses prior sessions", () => {
    const ctx = dailyContext(daily, ["2026-08-10"]);
    const c = ctx.get("2026-08-10")!;
    const prev = daily.filter((d) => d.date < "2026-08-10").at(-1)!;
    expect(c.prevClose).toBe(prev.c);
    expect(c.prevHigh).toBe(prev.h);
  });

  it("donchian flags breakouts", () => {
    const flat: Bar[] = Array.from({ length: 30 }, (_, i) => ({ t: OPEN + i * 300_000, o: 10, h: 10.1, l: 9.9, c: 10, v: 1 }));
    flat.push({ t: OPEN + 30 * 300_000, o: 10, h: 10.5, l: 10, c: 10.4, v: 1 });
    expect(donchianBreak(flat).at(-1)).toBe(1);
    expect(donchianBreak(flat)[25]).toBe(0);
  });
});
