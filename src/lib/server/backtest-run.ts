import "server-only";
import { runBacktest, type BacktestParams, type BacktestResult } from "@/lib/backtest";
import { addDays, etToday } from "@/lib/time";
import { getBars, getDailyBars } from "./alpaca";
import { sql } from "./db";
import { CORE } from "./scanner";
import { getSettings } from "./store";

const LOOKBACK_DAYS = 90;

export const BACKTEST_ASSUMPTIONS = {
  slippageBps: 5,
  feePerShare: 0,
};

export async function runAndStoreBacktest(): Promise<BacktestResult & { id: number; createdAt: string; params: BacktestParams }> {
  const settings = await getSettings();
  const today = etToday();
  const start = `${addDays(today, -LOOKBACK_DAYS)}T00:00:00Z`;
  // Historical consolidated data is free when it ends at least 15 minutes ago.
  const end = new Date(Date.now() - 20 * 60_000).toISOString();
  const symbols = [...CORE, "SPY", "QQQ"];
  const [bars, daily] = await Promise.all([
    getBars(symbols, { timeframe: "5Min", start, end, feed: "sip" }),
    getDailyBars(symbols, `${addDays(today, -LOOKBACK_DAYS - 40)}T00:00:00Z`, "sip"),
  ]);
  const params: BacktestParams = {
    startBalance: 5000,
    riskPct: settings.riskPct,
    maxDailyLossPct: settings.maxDailyLossPct,
    maxPositions: settings.maxPositions,
    minRR: settings.minRR,
    minScore: settings.minScore,
    exitScore: settings.exitScore,
    ...BACKTEST_ASSUMPTIONS,
  };
  const core = Object.fromEntries(CORE.map((s) => [s, bars[s] ?? []]));
  const result = runBacktest(core, daily, { spy: bars.SPY ?? [], qqq: bars.QQQ ?? [] }, params);
  const trades = result.trades.slice(-300);
  const [row] = await sql()`insert into backtests (params, summary, equity, trades)
    values (${JSON.stringify(params)}, ${JSON.stringify(result.summary)}, ${JSON.stringify(result.equity)}, ${JSON.stringify(trades)})
    returning id, created_at`;
  return { ...result, trades, params, id: row.id, createdAt: new Date(row.created_at).toISOString() };
}

export async function latestBacktest() {
  const [row] = await sql()`select * from backtests order by created_at desc limit 1`;
  if (!row) return null;
  return {
    id: row.id as number,
    createdAt: new Date(row.created_at).toISOString(),
    params: row.params as BacktestParams,
    summary: row.summary as BacktestResult["summary"],
    equity: row.equity as BacktestResult["equity"],
    trades: row.trades as BacktestResult["trades"],
  };
}
