import type { Settings } from "./types";

/** Tuning defaults. Reset keeps the auto trading switch as it is. */
export const DEFAULT_SETTINGS: Omit<Settings, "autoTrade"> = {
  riskPct: 1,
  maxDailyLossPct: 3,
  maxPositions: 3,
  minRR: 2,
  minScore: 70,
  exitScore: 40,
  dteMin: 3,
  dteMax: 10,
  maxPremiumPct: 25,
  closeEod: true,
  includeMovers: true,
};
