"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, useApi } from "@/hooks/use-api";
import type { BacktestResult, BacktestParams } from "@/lib/backtest";
import { contractLabel, dateTime, money, pct, price, signedMoney } from "@/lib/format";
import type { Portfolio, TradeRow } from "@/lib/types";
import { Card, Empty, SectionTitle, Stat } from "./card";
import { Confirm } from "./confirm";
import { EquityChart } from "./equity-chart";
import { useAppState } from "./state-provider";
import { Skeleton } from "./ui/skeleton";

interface Backtest {
  id: number;
  createdAt: string;
  params: BacktestParams;
  summary: BacktestResult["summary"];
  equity: BacktestResult["equity"];
  trades: BacktestResult["trades"];
}

interface JournalData {
  portfolio: Portfolio;
  maxDrawdownPct: number;
  equity: { t: number; equity: number }[];
  trades: TradeRow[];
  backtest: Backtest | null;
}

export function Journal() {
  const { data, error, loading, refresh } = useApi<JournalData>("/api/journal", 60_000);
  const { state, refresh: refreshState } = useAppState();
  const [running, setRunning] = useState(false);

  async function runBacktest() {
    setRunning(true);
    try {
      await api("/api/backtest", { method: "POST" });
      await refresh();
      toast.success("Backtest complete.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backtest failed.");
    } finally {
      setRunning(false);
    }
  }

  async function reset() {
    try {
      await api("/api/account/reset", { method: "POST" });
      await Promise.all([refresh(), refreshState()]);
      toast.success("Paper account reset to $5,000.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed.");
    }
  }

  if (loading && !data) return <Skeleton className="h-96 rounded-3xl bg-white/10" />;
  if (!data) return <Empty title="Journal unavailable" body={error ?? "Try again shortly."} />;

  const pf = data.portfolio;
  const closed = data.trades.filter((t) => t.status === "closed");
  const bt = data.backtest;

  return (
    <div className="grid gap-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Journal</h1>
          <p className="mt-1 text-sm text-white/50">Live paper results since {dateTime(pf.startedAt)}</p>
        </div>
        <Confirm
          title="Reset paper account?"
          body="Open positions are closed and the balance goes back to $5,000. History stays in the database."
          action="RESET"
          onConfirm={reset}
          trigger={(open) => (
            <button type="button" onClick={open} className="h-10 rounded-full border border-white/20 px-4 text-xs font-bold tracking-wider hover:bg-white hover:text-black">
              RESET
            </button>
          )}
        />
      </div>

      <Card>
        <SectionTitle>Paper performance</SectionTitle>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Balance" value={money(pf.equity)} sub={pct(pf.totalReturnPct)} />
          <Stat label="Realized" value={signedMoney(pf.realized)} />
          <Stat label="Win rate" value={pf.winRate == null ? "N/A" : `${Math.round(pf.winRate * 100)}%`} sub={`${pf.wins} of ${pf.closedTrades}`} />
          <Stat label="Avg plan R:R" value={pf.avgPlannedRR == null ? "N/A" : `${pf.avgPlannedRR.toFixed(1)}x`} />
          <Stat label="Avg result" value={pf.avgR == null ? "N/A" : `${pf.avgR >= 0 ? "+" : "−"}${Math.abs(pf.avgR).toFixed(2)}R`} />
          <Stat label="Max drawdown" value={`${data.maxDrawdownPct.toFixed(1)}%`} />
        </div>
        <div className="mt-6">
          {data.equity.length > 1 ? (
            <EquityChart points={data.equity} />
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-white/40">The growth chart fills in as the bot runs.</div>
          )}
        </div>
      </Card>

      <section>
        <SectionTitle>Trade history</SectionTitle>
        {closed.length === 0 ? (
          <Empty title="No closed trades yet" body="Every paper trade is logged here automatically." />
        ) : (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a]">
            <ul className="divide-y divide-white/10">
              {closed.map((t) => (
                <li key={t.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{t.symbol}</span>
                      <span className="text-xs whitespace-pre text-white/50">{contractLabel({ strike: t.strike, type: t.optionType, expiration: t.expiration })}</span>
                    </div>
                    <div className="tabular mt-0.5 text-xs text-white/45">
                      {t.qty}x {price(t.entryPrice)} to {price(t.exitPrice)} {t.exitReason ? ` ${t.exitReason}` : ""}
                    </div>
                    <div className="text-xs text-white/35">
                      {dateTime(t.openedAt)} {t.source === "auto" ? "Bot" : "Manual"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular font-semibold">{signedMoney(t.realizedPnl)}</div>
                    <div className="tabular text-xs text-white/45">
                      {t.plannedRisk > 0 && t.realizedPnl != null ? `${(t.realizedPnl / t.plannedRisk).toFixed(2)}R` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Card>
        <SectionTitle
          action={
            <button
              type="button"
              onClick={runBacktest}
              disabled={running || !state?.configured.data}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-xs font-bold tracking-wider text-black disabled:opacity-40"
            >
              {running && <Loader2 className="size-3.5 animate-spin" />}
              {running ? "RUNNING" : bt ? "RERUN" : "RUN BACKTEST"}
            </button>
          }
        >
          Backtest
        </SectionTitle>
        <p className="text-sm text-white/50">
          Historical simulation, not live results. Same signals on 5 minute bars for the watchlist, traded as shares, filled at the next bar open with{" "}
          {bt ? bt.params.slippageBps : 5} bps slippage per side.
        </p>
        {bt ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Return" value={pct(bt.summary.totalReturnPct)} sub={money(bt.summary.endBalance)} />
              <Stat label="Trades" value={bt.summary.trades} sub={`${bt.summary.sessions} sessions`} />
              <Stat label="Win rate" value={`${Math.round(bt.summary.winRate * 100)}%`} />
              <Stat label="Avg result" value={`${bt.summary.avgR.toFixed(2)}R`} />
              <Stat label="Profit factor" value={bt.summary.profitFactor == null ? "N/A" : bt.summary.profitFactor.toFixed(2)} />
              <Stat label="Max drawdown" value={`${bt.summary.maxDrawdownPct.toFixed(1)}%`} />
            </div>
            {bt.equity.length > 1 && (
              <div className="mt-6">
                <EquityChart points={[{ t: bt.equity[0].t - 1, equity: bt.params.startBalance }, ...bt.equity]} />
              </div>
            )}
            <div className="mt-3 text-xs text-white/35">
              {bt.summary.from} to {bt.summary.to}. Ran {dateTime(bt.createdAt)}. Option results differ from share results.
            </div>
          </>
        ) : (
          <div className="mt-5 text-sm text-white/40">No backtest has been run yet.</div>
        )}
      </Card>
    </div>
  );
}
