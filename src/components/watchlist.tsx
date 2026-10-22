"use client";

import Link from "next/link";
import { pct, price } from "@/lib/format";
import type { SymbolSignal } from "@/lib/types";
import { SignalBadge } from "./signal-badge";
import { Empty } from "./card";

export function Watchlist({ signals, held = [] }: { signals: SymbolSignal[]; held?: string[] }) {
  if (signals.length === 0) return <Empty title="No signals yet" body="Signals appear after the first scan with live data." />;
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a]">
      <div className="hidden grid-cols-[1.2fr_1fr_0.8fr_auto_3fr] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-medium tracking-wider text-white/40 uppercase md:grid">
        <span>Ticker</span>
        <span className="text-right">Price</span>
        <span className="text-right">Score</span>
        <span className="w-16 text-center">Signal</span>
        <span>Setup</span>
      </div>
      <ul className="divide-y divide-white/10">
        {signals.map((s) => (
          <li key={s.symbol}>
            <Link
              href={`/markets?s=${s.symbol}`}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-white/[0.03] md:grid-cols-[1.2fr_1fr_0.8fr_auto_3fr]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold">{s.symbol}</span>
                  {held.includes(s.symbol) && <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider">HELD</span>}
                  {!s.isCore && <span className="text-[10px] font-semibold tracking-wider text-white/40">MOVER</span>}
                </div>
                <div className="tabular text-xs text-white/45 md:hidden">
                  {price(s.price)} {s.changePct != null && <span>{pct(s.changePct)}</span>}
                </div>
              </div>
              <div className="tabular hidden text-right md:block">
                <div className="font-semibold">{price(s.price)}</div>
                <div className="text-xs text-white/45">{pct(s.changePct)}</div>
              </div>
              <div className="tabular text-right text-base font-semibold md:text-lg">{s.score}</div>
              <SignalBadge action={s.action} className="w-16" />
              <div className="col-span-3 truncate text-xs text-white/50 md:col-span-1 md:text-sm">
                {s.action !== "WAIT" && s.entry != null ? `Entry ${price(s.entry)}  Stop ${price(s.stop)}  Target ${price(s.target)}` : s.reason}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
