import { connection } from "next/server";
import { fail, json } from "@/lib/server/http";
import { getSettings, log, saveSettings } from "@/lib/server/store";
import type { Settings } from "@/lib/types";

const LIMITS: Record<Exclude<keyof Settings, "autoTrade" | "closeEod" | "includeMovers">, [number, number]> = {
  riskPct: [0.25, 5],
  maxDailyLossPct: [1, 10],
  maxPositions: [1, 5],
  minRR: [1, 5],
  minScore: [50, 95],
  exitScore: [10, 60],
  dteMin: [1, 30],
  dteMax: [2, 45],
  maxPremiumPct: [5, 50],
};

export async function GET() {
  await connection();
  try {
    return json(await getSettings());
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request) {
  try {
    const current = await getSettings();
    const body = (await request.json().catch(() => ({}))) as Partial<Record<keyof Settings, unknown>>;
    const next: Settings = { ...current };
    for (const key of ["autoTrade", "closeEod", "includeMovers"] as const) {
      if (typeof body[key] === "boolean") next[key] = body[key] as boolean;
    }
    for (const [key, [lo, hi]] of Object.entries(LIMITS) as [keyof typeof LIMITS, [number, number]][]) {
      const v = body[key];
      if (typeof v === "number" && Number.isFinite(v)) next[key] = Math.min(hi, Math.max(lo, v));
    }
    for (const key of ["maxPositions", "minScore", "exitScore", "dteMin", "dteMax"] as const) next[key] = Math.round(next[key]);
    if (next.dteMax <= next.dteMin) next.dteMax = next.dteMin + 1;
    if (next.exitScore >= next.minScore) next.exitScore = Math.max(10, next.minScore - 20);
    await saveSettings(next);
    if (next.autoTrade !== current.autoTrade) await log("settings", next.autoTrade ? "Auto trading resumed" : "Auto trading paused");
    return json(next);
  } catch (e) {
    return fail(e);
  }
}
