"use client";

import { useAppState } from "./state-provider";
import { cn } from "@/lib/utils";

export function StatusLine() {
  const { state } = useAppState();
  if (!state) return <div className="h-6 w-24 animate-pulse rounded-full bg-white/10" />;
  const bot = !state.configured.data ? "OFFLINE" : state.bot.halted ? "HALTED" : state.settings.autoTrade ? "AUTO" : "PAUSED";
  const market = state.clock?.isOpen ? "OPEN" : "CLOSED";
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider">
      <span className="flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-white/70">
        <span className={cn("size-1.5 rounded-full", state.clock?.isOpen ? "bg-white" : "bg-white/30")} />
        {market}
      </span>
      <span
        className={cn(
          "rounded-full px-2.5 py-1",
          bot === "AUTO" ? "bg-white text-black" : "border border-white/15 text-white/70",
        )}
      >
        {bot}
      </span>
    </div>
  );
}
