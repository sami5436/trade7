"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/use-api";
import { price } from "@/lib/format";
import type { SymbolSignal } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, Empty, SectionTitle } from "./card";
import { ConnectCard } from "./connect-card";
import { Freshness } from "./freshness";
import { PriceChart, type ChartData } from "./price-chart";
import { SignalBadge } from "./signal-badge";
import { useAppState } from "./state-provider";
import { ScoreBar, ScoreDetail } from "./trade-card";
import { Watchlist } from "./watchlist";
import { Skeleton } from "./ui/skeleton";

type Mode = "simple" | "chart";

interface ChartResponse extends Omit<ChartData, "levels"> {
  symbol: string;
  signal: SymbolSignal | null;
  asOf: string | null;
}

export function Markets() {
  const { state } = useAppState();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("s");
  const [mode, setMode] = useState<Mode>(selected ? "chart" : "simple");
  const signals = state?.scan.signals ?? [];
  const symbol = selected ?? signals[0]?.symbol ?? "NVDA";

  const select = (s: string) => {
    router.replace(`/markets?s=${s}`, { scroll: false });
    setMode("chart");
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Markets</h1>
        <div className="flex rounded-full border border-white/15 p-1" role="tablist" aria-label="View">
          {(["simple", "chart"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-9 rounded-full px-4 text-sm font-semibold capitalize transition",
                mode === m ? "bg-white text-black" : "text-white/60 hover:text-white",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {state && !state.configured.data && <ConnectCard />}

      {mode === "simple" ? (
        <Watchlist signals={signals} held={state?.positions.map((p) => p.symbol)} />
      ) : (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
            {signals.map((s) => (
              <button
                key={s.symbol}
                type="button"
                onClick={() => select(s.symbol)}
                className={cn(
                  "h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition",
                  s.symbol === symbol ? "border-white bg-white text-black" : "border-white/15 text-white/70 hover:text-white",
                )}
              >
                {s.symbol}
              </button>
            ))}
          </div>
          {state?.configured.data && <ChartPanel symbol={symbol} />}
        </>
      )}
      {state && <Freshness freshness={state.freshness} scannedAt={state.scan.at} />}
    </div>
  );
}

function ChartPanel({ symbol }: { symbol: string }) {
  const { data, error, loading } = useApi<ChartResponse>(`/api/chart?symbol=${symbol}`, 60_000);
  const chartData = useMemo<ChartData | null>(() => {
    if (!data || data.symbol !== symbol) return null;
    const s = data.signal;
    const show = s && s.action !== "WAIT";
    return {
      ...data,
      levels: { entry: show ? s.entry : null, stop: show ? s.stop : null, target: show ? s.target : null },
    };
  }, [data, symbol]);

  if (error) return <Empty title="Chart unavailable" body={error} />;
  if (loading || !chartData) return <Skeleton className="h-[420px] rounded-3xl bg-white/10" />;
  if (chartData.bars.length === 0) return <Empty title="No intraday bars" body="The data feed has no recent bars for this ticker." />;
  const s = data!.signal;

  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <Card className="p-3 md:p-4">
        <div className="flex items-center justify-between px-2 pt-1 pb-3">
          <div className="text-2xl font-extrabold">{symbol}</div>
          <div className="flex gap-3 text-[11px] text-white/45">
            <span>VWAP dashed</span>
            <span>EMA 9 light</span>
            <span>EMA 21 dark</span>
          </div>
        </div>
        <PriceChart data={chartData} />
        <div className="px-2 pt-2 text-[10px] text-white/35">
          5 minute bars. Lower panes: RSI 14 and MACD histogram. Charts by{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="underline">
            TradingView
          </a>
          .
        </div>
      </Card>
      {s && (
        <Card>
          <SectionTitle action={<SignalBadge action={s.action} />}>Signal</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Level label="Entry" value={price(s.entry)} />
            <Level label="Stop" value={price(s.stop)} />
            <Level label="Target" value={price(s.target)} />
          </div>
          <div className="mt-5 flex items-baseline justify-between">
            <span className="text-[11px] font-medium tracking-wider text-white/45 uppercase">Confidence</span>
            <span className="tabular font-semibold">{s.score}/100</span>
          </div>
          <div className="mt-2">
            <ScoreBar score={s.score} />
          </div>
          <p className="mt-4 text-sm text-white/80">{s.reason}</p>
          <div className="mt-5 border-t border-white/10 pt-5">
            <ScoreDetail components={s.components} />
          </div>
        </Card>
      )}
    </div>
  );
}

function Level({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-wider text-white/45 uppercase">{label}</div>
      <div className="tabular text-lg font-semibold">{value}</div>
    </div>
  );
}
