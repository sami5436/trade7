import "server-only";
import { FEE_PER_CONTRACT, round2 } from "@/lib/options";
import { daysBetween, etParts, etToday } from "@/lib/time";
import type { Settings, SymbolSignal, TradeRow } from "@/lib/types";
import { AlpacaError, alpacaConfigured, cancelOrder, getOptionQuotes, getOrder, getPositions, submitOptionOrder, type AlpacaOrder } from "./alpaca";
import { computePortfolio } from "./portfolio";
import { latestScan, priceSignal, saveScan, scan, type ScanResult } from "./scanner";
import {
  acquireLock,
  getAccount,
  getBotState,
  getSettings,
  insertTrade,
  listTrades,
  log,
  markCanceled,
  markClosed,
  markClosing,
  markOpen,
  markReopened,
  prune,
  recentlyClosed,
  releaseLock,
  setHalted,
  snapshotEquity,
  updateMark,
  type Account,
} from "./store";

const FLAT_AT = 15 * 60 + 50;
const ENTRY_TIMEOUT_MS = 3 * 60_000;
const COOLDOWN_MIN = 30;
const ACTIVE: TradeRow["status"][] = ["pending", "open", "closing"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForFill(id: string, tries = 5): Promise<AlpacaOrder> {
  let order = await getOrder(id);
  for (let i = 0; i < tries && !["filled", "canceled", "expired", "rejected"].includes(order.status); i++) {
    await sleep(1000);
    order = await getOrder(id);
  }
  return order;
}

/** Brings pending entries and exits in line with what the broker reports. */
async function reconcileOrders(trades: TradeRow[]) {
  for (const t of trades) {
    try {
      if (t.status === "pending" && t.entryOrderId) {
        let order = await getOrder(t.entryOrderId);
        const age = Date.now() - Date.parse(t.createdAt);
        if (!["filled", "canceled", "expired", "rejected"].includes(order.status) && age > ENTRY_TIMEOUT_MS) {
          await cancelOrder(order.id);
          order = await getOrder(order.id);
        }
        const filled = Number(order.filled_qty);
        if (order.status === "filled" || (filled > 0 && ["canceled", "expired"].includes(order.status))) {
          await markOpen(t.id, Number(order.filled_avg_price), filled, filled * FEE_PER_CONTRACT);
          await log("entry", `Filled ${filled} ${t.optionSymbol} at $${Number(order.filled_avg_price).toFixed(2)}`);
        } else if (["canceled", "expired", "rejected"].includes(order.status)) {
          await markCanceled(t.id, "Entry order not filled");
          await log("cancel", `Entry for ${t.symbol} was not filled and was canceled`);
        }
      } else if (t.status === "closing" && t.exitOrderId) {
        const order = await getOrder(t.exitOrderId);
        if (order.status === "filled") {
          await markClosed(t, Number(order.filled_avg_price), t.exitReason ?? "exit", t.qty * FEE_PER_CONTRACT);
          await log("exit", `Closed ${t.symbol} at $${Number(order.filled_avg_price).toFixed(2)}`);
        } else if (["canceled", "expired", "rejected"].includes(order.status)) {
          await markReopened(t.id);
        }
      }
    } catch (e) {
      await log("error", `Order check for ${t.symbol} failed: ${message(e)}`);
    }
  }
}

export async function closeTrade(t: TradeRow, reason: string): Promise<string> {
  if (t.status === "pending") {
    if (t.entryOrderId) await cancelOrder(t.entryOrderId);
    await markCanceled(t.id, reason);
    return "canceled";
  }
  if (t.status !== "open") return t.status;
  const order = await submitOptionOrder({ symbol: t.optionSymbol, qty: t.qty, side: "sell" });
  await markClosing(t.id, order.id, reason);
  const done = await waitForFill(order.id);
  if (done.status === "filled") {
    await markClosed(t, Number(done.filled_avg_price), reason, t.qty * FEE_PER_CONTRACT);
    await log("exit", `${reason}: sold ${t.qty} ${t.optionSymbol} at $${Number(done.filled_avg_price).toFixed(2)}`);
    return "closed";
  }
  return "closing";
}

function exitReason(t: TradeRow, sig: SymbolSignal | undefined, settings: Settings, halted: boolean): string | null {
  const now = Date.now();
  const { minutes } = etParts(now);
  const swing = t.holdStyle === "swing";
  if (halted) return "Daily loss limit";
  if (!swing && settings.closeEod && minutes >= FLAT_AT) return "Market close";
  if (daysBetween(etToday(now), t.expiration) <= 1) return "Expiration";
  if (t.mark != null && t.mark <= t.optionStop) return "Stop";
  const u = sig?.price;
  if (u != null) {
    const long = t.direction === "long";
    if (long ? u <= t.underlyingStop : u >= t.underlyingStop) return "Stop";
    if (long ? u >= t.underlyingTarget : u <= t.underlyingTarget) return "Target";
  }
  // Swing holds ignore intraday score swings and only exit on levels, the premium stop or expiry.
  if (sig && !swing) {
    const own = t.direction === "long" ? sig.longScore : sig.shortScore;
    const flipped = t.direction === "long" ? sig.action === "SELL" : sig.action === "BUY";
    if (flipped) return "Signal reversed";
    if (own < settings.exitScore && sig.components) return "Momentum faded";
  }
  return null;
}

export interface EntryCheck {
  ok: boolean;
  reason?: string;
}

export function canEnter(
  sig: SymbolSignal,
  ctx: { settings: Settings; active: TradeRow[]; halted: boolean; dayPnl: number; dayStart: number; cooled: string[] },
): EntryCheck {
  const { settings } = ctx;
  if (ctx.halted) return { ok: false, reason: "Daily loss limit reached. Trading resumes tomorrow." };
  if (sig.action === "WAIT" || !sig.option) return { ok: false, reason: sig.optionReason ?? sig.reason };
  if (ctx.active.length >= settings.maxPositions) return { ok: false, reason: `Already holding ${settings.maxPositions} positions.` };
  if (ctx.active.some((t) => t.symbol === sig.symbol)) return { ok: false, reason: `Already in ${sig.symbol}.` };
  if (ctx.cooled.includes(sig.symbol)) return { ok: false, reason: `${sig.symbol} closed recently. Waiting ${COOLDOWN_MIN} minutes.` };
  const limit = (ctx.dayStart * settings.maxDailyLossPct) / 100;
  if (ctx.dayPnl - sig.option.plannedRisk < -limit) return { ok: false, reason: "This trade could breach the daily loss limit." };
  return { ok: true };
}

export async function openTrade(sig: SymbolSignal, account: Account, source: "auto" | "manual"): Promise<TradeRow> {
  const o = sig.option!;
  const order = await submitOptionOrder({ symbol: o.symbol, qty: o.contracts, side: "buy", limit: round2(o.ask) });
  const trade = await insertTrade({
    accountId: account.id,
    source,
    holdStyle: sig.holdStyle ?? "day",
    symbol: sig.symbol,
    direction: sig.direction!,
    optionSymbol: o.symbol,
    optionType: o.type,
    strike: o.strike,
    expiration: o.expiration,
    qty: o.contracts,
    status: "pending",
    entryOrderId: order.id,
    entryLimit: round2(o.ask),
    entryPrice: null,
    underlyingEntry: sig.entry!,
    underlyingStop: sig.stop!,
    underlyingTarget: sig.target!,
    optionStop: o.optionStop,
    plannedRisk: o.plannedRisk,
    plannedReward: o.plannedReward,
    plannedRR: o.rr,
    score: sig.score,
    reason: sig.reason,
    fees: 0,
    mark: (o.bid + o.ask) / 2,
    delta: o.delta,
  });
  await log("order", `${source === "auto" ? "Bot" : "You"} bought ${o.contracts} ${sig.symbol} $${o.strike} ${o.type} at up to $${o.ask.toFixed(2)}`);
  const done = await waitForFill(order.id);
  const filled = Number(done.filled_qty);
  if (done.status === "filled") {
    await markOpen(trade.id, Number(done.filled_avg_price), filled, filled * FEE_PER_CONTRACT);
    return { ...trade, status: "open", entryPrice: Number(done.filled_avg_price), qty: filled };
  }
  return trade;
}

export interface TickResult {
  ran: boolean;
  status: string;
  message: string;
}

/**
 * One pass of the autonomous loop: reconcile orders, mark positions, exit, then enter at most one new trade.
 * A database lease makes overlapping triggers (scheduler and open app) safe.
 */
export async function tick(trigger: string, minGapSeconds = 0): Promise<TickResult> {
  if (!alpacaConfigured()) return { ran: false, status: "idle", message: "Market data is not connected." };
  if (!(await acquireLock(120, minGapSeconds))) return { ran: false, status: "skipped", message: "Another run is in progress." };
  let status = "ok";
  let msg = "";
  try {
    const [settings, account, botState] = await Promise.all([getSettings(), getAccount(), getBotState()]);
    await reconcileOrders(await listTrades(account.id, ["pending", "closing"]));

    let open = await listTrades(account.id, ["open"]);
    const today = etToday();
    let halted = botState.haltedDate === today;

    // Fresh marks from the indicative options feed.
    const quotes = await getOptionQuotes(open.map((t) => t.optionSymbol)).catch(() => ({}) as Awaited<ReturnType<typeof getOptionQuotes>>);
    for (const t of open) {
      const q = quotes[t.optionSymbol];
      if (q && q.bid > 0 && q.ask > 0) {
        t.mark = (q.bid + q.ask) / 2;
        await updateMark(t.id, t.mark, q.delta);
      }
    }

    let pf = await computePortfolio(account);
    const dayStart = pf.equity - pf.dayPnl;
    const limit = (dayStart * settings.maxDailyLossPct) / 100;

    const result: ScanResult = await scan({ settings, equity: pf.equity, cash: pf.cash, withOptions: true });
    await saveScan(result, trigger);

    if (!result.marketOpen) {
      msg = "Market closed.";
    } else {
      // Positions closed outside the app (or expired) no longer exist at the broker.
      const held = new Set((await getPositions()).map((p) => p.symbol));
      for (const t of open) {
        if (!held.has(t.optionSymbol)) {
          await markClosed(t, t.mark ?? 0, "Closed at broker", 0);
          await log("exit", `${t.optionSymbol} is no longer held at the broker`);
        }
      }
      open = open.filter((t) => held.has(t.optionSymbol));

      if (!halted && pf.dayPnl <= -limit) {
        halted = true;
        await setHalted(today);
        await log("halt", `Daily loss limit hit at $${pf.dayPnl.toFixed(2)}. Closing everything.`);
      }

      const bySymbol = new Map(result.signals.map((s) => [s.symbol, s]));
      for (const t of open) {
        const why = exitReason(t, bySymbol.get(t.symbol), settings, halted);
        if (why) await closeTrade(t, why).catch((e) => log("error", `Exit ${t.symbol} failed: ${message(e)}`));
      }

      pf = await computePortfolio(account);
      const active = await listTrades(account.id, ACTIVE);
      const cooled = await recentlyClosed(account.id, COOLDOWN_MIN);
      msg = result.best ? `Best: ${result.best.symbol} ${result.best.action} ${result.best.score}` : (result.message ?? "No setup qualifies.");

      if (settings.autoTrade && !halted) {
        const candidates = result.signals.filter((s) => s.option && s.action !== "WAIT").sort((a, b) => b.score - a.score);
        for (const sig of candidates) {
          const check = canEnter(sig, { settings, active, halted, dayPnl: pf.dayPnl, dayStart, cooled });
          if (!check.ok) continue;
          await openTrade(sig, account, "auto");
          msg = `Entered ${sig.symbol} ${sig.direction === "long" ? "call" : "put"}`;
          break;
        }
      }
    }

    const final = await computePortfolio(account);
    await snapshotEquity(account.id, final.equity, final.cash);
    if (Math.random() < 0.02) await prune();
  } catch (e) {
    status = "error";
    msg = message(e);
    await log("error", msg).catch(() => {});
  } finally {
    await releaseLock(status, msg).catch(() => {});
  }
  return { ran: true, status, message: msg };
}

/** Manual FIND TRADE: a fresh scan without placing anything. */
export async function findTrade(): Promise<ScanResult> {
  const [settings, account] = await Promise.all([getSettings(), getAccount()]);
  const pf = await computePortfolio(account);
  const result = await scan({ settings, equity: pf.equity, cash: pf.cash, withOptions: true });
  await saveScan(result, "manual");
  return result;
}

/** One tap paper trade. Everything is re-derived on the server from a fresh scan. */
export async function manualTrade(symbol: string): Promise<{ ok: boolean; message: string; trade?: TradeRow }> {
  const [settings, account, botState] = await Promise.all([getSettings(), getAccount(), getBotState()]);
  const pf = await computePortfolio(account);
  const result = await scan({ settings, equity: pf.equity, cash: pf.cash, withOptions: true });
  await saveScan(result, "manual");
  const sig = result.signals.find((s) => s.symbol === symbol);
  if (!sig) return { ok: false, message: `${symbol} no longer qualifies.` };
  if (!sig.option && sig.action !== "WAIT") {
    // The scan only prices the strongest few setups, so price this one directly if needed.
    await priceSignal(sig, { settings, equity: pf.equity, cash: pf.cash, withOptions: true }).catch(() => {});
  }
  const active = await listTrades(account.id, ACTIVE);
  const check = canEnter(sig, {
    settings,
    active,
    halted: botState.haltedDate === etToday(),
    dayPnl: pf.dayPnl,
    dayStart: pf.equity - pf.dayPnl,
    cooled: [],
  });
  if (!check.ok) return { ok: false, message: check.reason ?? "Trade blocked by risk rules." };
  const trade = await openTrade(sig, account, "manual");
  return { ok: true, message: trade.status === "open" ? "Paper trade filled." : "Order sent. Waiting for a fill.", trade };
}

export async function closeAll(reason: string) {
  const account = await getAccount();
  const trades = await listTrades(account.id, ACTIVE);
  for (const t of trades) await closeTrade(t, reason).catch((e) => log("error", `Close ${t.symbol} failed: ${message(e)}`));
}

export { latestScan };

function message(e: unknown) {
  if (e instanceof AlpacaError) return `Broker: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
