import { connection } from "next/server";
import { alpacaConfigured, getClock } from "@/lib/server/alpaca";
import { fail, json } from "@/lib/server/http";
import { computePortfolio } from "@/lib/server/portfolio";
import { latestScan } from "@/lib/server/scanner";
import { getBotState, getSettings, recentLog } from "@/lib/server/store";
import { etToday } from "@/lib/time";
import type { AppState } from "@/lib/types";

export async function GET() {
  await connection();
  try {
    const configured = alpacaConfigured();
    const [pf, settings, scan, bot, log, clock] = await Promise.all([
      computePortfolio(),
      getSettings(),
      latestScan(),
      getBotState(),
      recentLog(15),
      configured ? getClock().catch(() => null) : Promise.resolve(null),
    ]);
    const { trades, ...portfolio } = pf;
    const asOf = scan.dataAsOf;
    const state: AppState = {
      configured: { data: configured, db: true },
      portfolio,
      positions: trades.filter((t) => t.status === "open" || t.status === "pending" || t.status === "closing"),
      settings,
      scan: { id: scan.id, at: scan.at, marketOpen: scan.marketOpen, message: scan.message, signals: scan.signals, best: scan.best },
      clock: clock ? { isOpen: clock.is_open, nextOpen: clock.next_open, nextClose: clock.next_close } : null,
      freshness: {
        stocks: "IEX real time",
        options: "Indicative, delayed",
        asOf,
        stale: Boolean(clock?.is_open && (!asOf || Date.now() - Date.parse(asOf) > 15 * 60_000)),
      },
      bot: { lastTickAt: bot.lastTickAt, lastStatus: bot.lastStatus, lastMessage: bot.lastMessage, halted: bot.haltedDate === etToday() },
      log,
    };
    return json(state);
  } catch (e) {
    return fail(e);
  }
}
