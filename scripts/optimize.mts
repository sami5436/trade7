// Walk-forward optimizer for TRADE7.
// Usage: npx tsx --conditions react-server scripts/optimize.mts [--holdout]
// Data: run scripts/optimizer/fetch.mts first (writes to $T7_DATA or scripts/tmp). See scripts/tmp/DATA.md.
import { writeFileSync } from "node:fs";
import {
  HOLDOUT_FROM,
  load,
  monthsAdd,
  simIntraday,
  simSwing,
  spyReturn,
  stats,
  type IntradayCfg,
  type MomentumCfg,
  type PullbackCfg,
  type Stats,
  type SwingCfg,
  type Trade,
} from "./optimizer/lib.mts";

type Cfg = IntradayCfg | SwingCfg;

function grid(): Cfg[] {
  const out: Cfg[] = [];
  for (const minScore of [60, 70, 80, 85])
    for (const minRR of [1.5, 2, 3])
      for (const [minStop, minT, maxT] of [[1, 2, 4], [1.5, 3, 6]] as const)
        for (const fadeExit of [true, false])
          for (const marketGate of [true, false])
            for (const dailyGate of [true, false])
              for (const [from, until] of [[585, 690], [585, 930]] as const)
                for (const maxPos of [1, 3])
                  out.push({ family: "momentum", minScore, minRR, minStop, minT, maxT, fadeExit, marketGate, dailyGate, from, until, maxPos } satisfies MomentumCfg);
  for (const rMult of [1.5, 2, 3, 0])
    for (const marketGate of [true, false])
      for (const touch of ["vwap", "ema21"] as const)
        for (const [from, until] of [[600, 720], [600, 900]] as const)
          for (const maxPos of [1, 3]) out.push({ family: "pullback", rMult, marketGate, touch, from, until, maxPos, fadeExit: false } satisfies PullbackCfg);
  for (const entry of ["breakout20", "breakout55", "trend"] as const)
    for (const stopAtr of [1.5, 2.5])
      for (const targetAtr of [0, 3, 5])
        for (const maxDays of [5, 10, 20])
          for (const marketGate of [true, false])
            for (const shorts of [false, true])
              for (const maxPos of [3, 5]) out.push({ family: "swing", entry, stopAtr, targetAtr, maxDays, marketGate, shorts, maxPos } satisfies SwingCfg);
  return out;
}

const run = (d: ReturnType<typeof load>, c: Cfg, from: string, to: string): Trade[] =>
  c.family === "swing" ? simSwing(d, c, from, to) : simIntraday(d, c, from, to);

/** Train objective: t-stat style avgR * sqrt(n), requiring a minimum sample. */
function objective(s: Stats, family: Cfg["family"]): number {
  const min = family === "swing" ? 12 : 40;
  if (s.trades < min) return -Infinity;
  return s.avgR * Math.sqrt(s.trades);
}

const label = (c: Cfg) => JSON.stringify(c);
const fmt = (s: Stats) => `${String(s.trades).padStart(5)} ${(s.winRate * 100).toFixed(0).padStart(3)}% ${s.avgR.toFixed(3).padStart(7)} ${s.sumR.toFixed(1).padStart(7)}R pf ${s.pf.toFixed(2)} dd ${s.maxDdR.toFixed(1)}R`;

const d = load();
const configs = grid();
console.log(`configs: ${configs.length} (momentum ${configs.filter((c) => c.family === "momentum").length}, pullback ${configs.filter((c) => c.family === "pullback").length}, swing ${configs.filter((c) => c.family === "swing").length})`);

const windows: { trainFrom: string; testFrom: string; testTo: string }[] = [];
for (let testFrom = "2025-05-01"; testFrom < HOLDOUT_FROM; testFrom = monthsAdd(testFrom, 2)) {
  const testTo = monthsAdd(testFrom, 2) < HOLDOUT_FROM ? monthsAdd(testFrom, 2) : HOLDOUT_FROM;
  windows.push({ trainFrom: monthsAdd(testFrom, -6), testFrom, testTo });
}

const families = ["all", "momentum", "pullback", "swing"] as const;
const oos: Record<string, Trade[]> = Object.fromEntries(families.map((f) => [f, []]));
const rows: string[] = [];
const picks: Record<string, string[]> = Object.fromEntries(families.map((f) => [f, []]));

for (const w of windows) {
  const scored = configs.map((c) => ({ c, s: stats(run(d, c, w.trainFrom, w.testFrom)) }));
  for (const fam of families) {
    const pool = scored.filter((x) => fam === "all" || x.c.family === fam);
    pool.sort((a, b) => objective(b.s, b.c.family) - objective(a.s, a.c.family));
    const best = pool[0];
    if (!best || objective(best.s, best.c.family) === -Infinity) continue;
    const test = run(d, best.c, w.testFrom, w.testTo);
    oos[fam].push(...test);
    picks[fam].push(label(best.c));
    if (fam === "all" || fam === "swing" || fam === "momentum")
      rows.push(`${w.testFrom}..${w.testTo} ${fam.padEnd(8)} train ${fmt(best.s)} | test ${fmt(stats(test))} | SPY ${spyReturn(d, w.testFrom, w.testTo).toFixed(1)}% | ${best.c.family}`);
  }
}

console.log("\nPer window (selected on train, evaluated on next 2 months):");
for (const r of rows) console.log(r);
console.log("\nAggregate out of sample by selection pool:");
for (const fam of families) console.log(fam.padEnd(9), fmt(stats(oos[fam])));

// Stability: which fixed configs are positive in most test windows.
console.log("\nFixed configs over all test windows (no reselection):");
const fixed = configs.map((c) => {
  const per = windows.map((w) => stats(run(d, c, w.testFrom, w.testTo)));
  const all = stats(windows.flatMap((w) => run(d, c, w.testFrom, w.testTo)));
  return { c, all, positive: per.filter((s) => s.sumR > 0).length };
});
fixed.sort((a, b) => b.all.avgR * Math.sqrt(b.all.trades) - a.all.avgR * Math.sqrt(a.all.trades));
for (const f of fixed.slice(0, 12)) console.log(fmt(f.all), `pos ${f.positive}/${windows.length}`, label(f.c));

// Benchmark: always long with the swing exit rules of the top swing config.
const topSwing = fixed.find((f) => f.c.family === "swing")?.c as SwingCfg | undefined;
if (topSwing) {
  const bench = { ...topSwing, entry: "always" as const, shorts: false };
  console.log("\nBenchmark always-long with same exits:", fmt(stats(windows.flatMap((w) => simSwing(d, bench, w.testFrom, w.testTo)))));
}
writeFileSync(`${process.env.T7_DATA ?? "scripts/tmp"}/wf-results.json`, JSON.stringify({ windows, picks, fixed: fixed.slice(0, 50).map((f) => ({ c: f.c, all: f.all, positive: f.positive })) }));
