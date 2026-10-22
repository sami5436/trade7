"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/hooks/use-api";
import { COMPONENT_LABELS, WEIGHTS, type Component } from "@/lib/engine";
import { money, orderText, price, strategyName } from "@/lib/format";
import type { HoldStyle, SymbolSignal } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card } from "./card";
import { SignalBadge } from "./signal-badge";

export function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-white transition-all" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
    </div>
  );
}

export function ScoreDetail({ components }: { components: SymbolSignal["components"] }) {
  if (!components) return null;
  return (
    <div className="grid gap-2.5">
      {(Object.keys(WEIGHTS) as Component[]).map((k) => (
        <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-white/60">{COMPONENT_LABELS[k]}</span>
          <span className="tabular text-white/80">
            {components[k]}/{WEIGHTS[k]}
          </span>
          <div className="col-span-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-white/80" style={{ width: `${(components[k] / WEIGHTS[k]) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Level({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wider text-white/45 uppercase">{label}</div>
      <div className="tabular mt-0.5 text-xl font-semibold md:text-2xl">{value}</div>
      {sub && <div className="tabular text-xs text-white/45">{sub}</div>}
    </div>
  );
}

export function TradeCard({
  signal,
  onTraded,
  canTrade = true,
  holdStyle = "day",
}: {
  signal: SymbolSignal;
  onTraded?: () => void;
  canTrade?: boolean;
  holdStyle?: HoldStyle;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const o = signal.option;

  async function trade() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/trade", { json: { symbol: signal.symbol } });
      toast.success(r.message);
      onTraded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Trade failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-white/20">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-4xl font-extrabold tracking-tight md:text-5xl">{signal.symbol}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {o && <Tag strong>{strategyName(o.type)}</Tag>}
            <Tag>{holdStyle === "swing" ? "SWING HOLD" : "DAY TRADE"}</Tag>
          </div>
        </div>
        <SignalBadge action={signal.action === "WAIT" ? "WAIT" : signal.action} size="lg" />
      </div>

      {o ? (
        <p className="mt-5 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/85">{orderText(signal.symbol, o)}</p>
      ) : (
        signal.optionReason && <p className="mt-5 text-sm text-white/50">{signal.optionReason}</p>
      )}

      <div className="mt-5 grid grid-cols-3 gap-4">
        <Level label={`${signal.symbol} entry`} value={price(signal.entry)} sub={o ? `Pay ${price(o.ask)}` : undefined} />
        <Level label="Stock stop" value={price(signal.stop)} sub={o ? `Opt ${price(o.optionStop)}` : undefined} />
        <Level label="Stock target" value={price(signal.target)} sub={o ? `${o.rr.toFixed(1)}x reward` : undefined} />
      </div>

      {o && (
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
          <Level label="Contracts" value={String(o.contracts)} sub={`${o.dte} days left`} />
          <Level label="Cost" value={money(o.cost)} />
          <Level label="Max risk" value={money(o.plannedRisk)} />
        </div>
      )}

      <div className="mt-5 border-t border-white/10 pt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium tracking-wider text-white/45 uppercase">Confidence</span>
          <span className="tabular text-lg font-semibold">{signal.score}/100</span>
        </div>
        <div className="mt-2">
          <ScoreBar score={signal.score} />
        </div>
        <p className="mt-4 text-base text-white/85">{signal.reason}</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-white/50 hover:text-white"
          aria-expanded={open}
        >
          Score detail
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="mt-3">
            <ScoreDetail components={signal.components} />
          </div>
        )}
      </div>

      {o && canTrade && (
        <button
          type="button"
          onClick={trade}
          disabled={busy}
          className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold tracking-wide text-black transition active:scale-[0.99] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          PAPER TRADE
        </button>
      )}
    </Card>
  );
}

function Tag({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider",
        strong ? "bg-white text-black" : "border border-white/15 text-white/60",
      )}
    >
      {children}
    </span>
  );
}
