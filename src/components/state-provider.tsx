"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { api, useApi } from "@/hooks/use-api";
import type { AppState } from "@/lib/types";

interface Ctx {
  state: AppState | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const StateContext = createContext<Ctx | null>(null);

const POLL_MS = 20_000;
const TICK_MS = 60_000;

export function StateProvider({ children }: { children: React.ReactNode }) {
  const { data, error, loading, refresh } = useApi<AppState>("/api/state", POLL_MS);
  const configured = data?.configured.data ?? false;
  const marketOpen = data?.clock?.isOpen ?? false;
  const ticking = useRef(false);

  // While the app is open during market hours it also drives the bot, about once a minute.
  useEffect(() => {
    if (!configured || !marketOpen) return;
    const run = async () => {
      if (ticking.current || document.visibilityState !== "visible") return;
      ticking.current = true;
      try {
        const r = await api<{ ran: boolean }>("/api/bot/tick", { method: "POST" });
        if (r.ran) await refresh();
      } catch {
        // The scheduler keeps running even if this request fails.
      } finally {
        ticking.current = false;
      }
    };
    run();
    const id = setInterval(run, TICK_MS);
    return () => clearInterval(id);
  }, [configured, marketOpen, refresh]);

  return <StateContext.Provider value={{ state: data, error, loading, refresh }}>{children}</StateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useAppState must be used inside StateProvider");
  return ctx;
}
