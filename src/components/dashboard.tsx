"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/hooks/use-api";
import { money, pct, signedMoney } from "@/lib/format";
import type { ScanSummary, SymbolSignal } from "@/lib/types";
import { Card, Empty, SectionTitle, Stat } from "./card";
import { ConnectCard } from "./connect-card";
import { Freshness } from "./freshness";
import { Positions } from "./positions";
import { useAppState } from "./state-provider";
import { TradeCard } from "./trade-card";
import { Watchlist } from "./watchlist";
import { Skeleton } from "./ui/skeleton";

export function Dashboard() {
  const { state, error, loading, refresh } = useAppState();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<{ best: SymbolSignal | null; message: string | null } | null>(null);

  async function findTrade() {
    setScanning(true);
    try {
      const r = await api<ScanSummary>("/api/scan", { method: "POST" });
      setFound({ best: r.best, message: r.message });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  if (loading && !state) return <DashboardSkeleton />;
  if (!state) return <Empty title="Could not load your account" body={error ?? "Check your connection and try again."} />;

  const pf = state.portfolio;
  const best = found ? found.best : state.scan.best;
  const held = state.positions.map((p) => p.symbol);

  return (
    <div className="grid gap-6 md:grid-cols-[1.1fr_1fr] md:gap-8">
      <div className="grid content-start gap-6">
        <section aria-label="Portfolio">
          <div className="text-xs font-semibold tracking-[0.18em] text-white/45 uppercase">Paper balance</div>
          <div className="tabular mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl md:text-7xl">{money(pf.equity)}</div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <Stat label="Today" value={signedMoney(pf.dayPnl)} sub={pct(pf.dayPnlPct)} />
            <Stat label="Total" value={pct(pf.totalReturnPct)} sub={signedMoney(pf.equity - pf.startBalance)} />
            <Stat label="Win rate" value={pf.winRate == null ? "N/A" : `${Math.round(pf.winRate * 100)}%`} sub={`${pf.closedTrades} trades`} />
          </div>
        </section>

        {!state.configured.data && <ConnectCard />}

        <button
          type="button"
          onClick={findTrade}
          disabled={scanning || !state.configured.data}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-white text-lg font-extrabold tracking-wider text-black transition active:scale-[0.99] disabled:opacity-40"
        >
          {scanning ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" strokeWidth={2.5} />}
          {scanning ? "SCANNING" : "FIND TRADE"}
        </button>

        {state.bot.halted && (
          <Card>
            <div className="font-semibold">Daily loss limit reached</div>
            <p className="mt-1 text-sm text-white/55">New trades are off until tomorrow.</p>
          </Card>
        )}

        <section>
          <SectionTitle>Best setup</SectionTitle>
          {best ? (
            <TradeCard signal={best} onTraded={refresh} canTrade={!held.includes(best.symbol)} holdStyle={state.settings.holdStyle} />
          ) : (
            <Empty
              title="No setup qualifies"
              body={(found ? found.message : state.scan.message) ?? "Nothing meets the score, volume and reward rules right now."}
            />
          )}
        </section>
      </div>

      <div className="grid content-start gap-6">
        <section>
          <SectionTitle>Active positions</SectionTitle>
          <Positions positions={state.positions} onChange={refresh} />
        </section>
        <section>
          <SectionTitle>Watchlist</SectionTitle>
          <Watchlist signals={state.scan.signals} held={held} />
          <div className="mt-3">
            <Freshness freshness={state.freshness} scannedAt={state.scan.at} />
          </div>
        </section>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-4 w-28 bg-white/10" />
      <Skeleton className="h-16 w-64 bg-white/10" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-12 bg-white/10" />
        <Skeleton className="h-12 bg-white/10" />
        <Skeleton className="h-12 bg-white/10" />
      </div>
      <Skeleton className="h-16 rounded-2xl bg-white/10" />
      <Skeleton className="h-64 rounded-3xl bg-white/10" />
    </div>
  );
}
