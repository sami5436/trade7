"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/hooks/use-api";
import { contractLabel, price, signedMoney } from "@/lib/format";
import type { TradeRow } from "@/lib/types";
import { Empty } from "./card";

function pnl(t: TradeRow) {
  if (t.entryPrice == null) return null;
  return ((t.mark ?? t.entryPrice) - t.entryPrice) * t.qty * 100 - t.fees;
}

export function Positions({ positions, onChange }: { positions: TradeRow[]; onChange: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);

  async function exit(id: number) {
    setBusy(id);
    try {
      const r = await api<{ message: string }>("/api/positions/close", { json: { id } });
      toast.success(r.message);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Exit failed.");
    } finally {
      setBusy(null);
    }
  }

  if (positions.length === 0) return <Empty title="No open positions" body="The bot opens trades here when a setup qualifies." />;

  return (
    <div className="grid gap-3">
      {positions.map((t) => {
        const p = pnl(t);
        return (
          <div key={t.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-[#0a0a0a] p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{t.symbol}</span>
                <span className="text-xs font-semibold text-white/50">{t.qty}x</span>
                {t.status !== "open" && (
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white/60">
                    {t.status === "pending" ? "FILLING" : "EXITING"}
                  </span>
                )}
              </div>
              <div className="truncate text-xs whitespace-pre text-white/50">{contractLabel({ strike: t.strike, type: t.optionType, expiration: t.expiration })}</div>
              <div className="tabular mt-1 text-xs text-white/40">
                In {price(t.entryPrice ?? t.entryLimit)} Now {price(t.mark)} Stop {price(t.underlyingStop)} Target {price(t.underlyingTarget)}
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-base font-semibold">{p == null ? "" : signedMoney(p)}</div>
              <button
                type="button"
                onClick={() => exit(t.id)}
                disabled={busy === t.id || t.status === "closing"}
                className="mt-2 inline-flex h-9 min-w-16 items-center justify-center rounded-full border border-white/25 px-4 text-xs font-bold tracking-wider transition hover:bg-white hover:text-black disabled:opacity-50"
              >
                {busy === t.id ? <Loader2 className="size-3.5 animate-spin" /> : "EXIT"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
