"use client";

import { useNow } from "@/hooks/use-api";
import { ago } from "@/lib/format";
import type { Freshness as F } from "@/lib/types";

export function Freshness({ freshness, scannedAt }: { freshness: F; scannedAt: string | null }) {
  const now = useNow(5000);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
      <span>Stocks: {freshness.stocks}</span>
      <span>Options: {freshness.options}</span>
      <span>Bars {freshness.asOf ? ago(freshness.asOf, now) : "not loaded"}</span>
      <span>Scan {ago(scannedAt, now)}</span>
      {freshness.stale && <span className="font-semibold text-white">Data stale</span>}
    </div>
  );
}
