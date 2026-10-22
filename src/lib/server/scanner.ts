import "server-only";
import { buildSeries, dailyAtr, decide, lastClosedIndex, scoreAt, trendAt, BAR_MS, type Series } from "@/lib/engine";
import { chooseContract } from "@/lib/options";
import { addDays, etParts, etToday, formatMinutes } from "@/lib/time";
import type { DailyBar } from "@/lib/engine";
import type { OptionSetup, ScanSummary, Settings, SymbolSignal } from "@/lib/types";
import { getAsset, getBars, getClock, getDailyBars, getMostActive, getOptionChain, getSnapshots, type Clock, type StockSnapshot } from "./alpaca";
import { num, numOrNull, sql } from "./db";

export const CORE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];
const INDEXES = ["SPY", "QQQ"];
const ENTRY_FROM = 9 * 60 + 45;
const ENTRY_UNTIL = 15 * 60 + 30;
const STALE_MS = 15 * 60_000;
const MAX_MOVERS = 3;

export interface MarketData {
  clock: Clock;
  series: Record<string, Series>;
  daily: Record<string, DailyBar[]>;
  snapshots: Record<string, StockSnapshot>;
  movers: string[];
  fetchedAt: number;
}

async function pickMovers(exclude: string[]): Promise<string[]> {
  try {
    const active = (await getMostActive(25)).filter((s) => !exclude.includes(s) && /^[A-Z]{1,5}$/.test(s));
    const snaps = await getSnapshots(active);
    const out: string[] = [];
    for (const sym of active) {
      if (out.length >= MAX_MOVERS) break;
      if ((snaps[sym]?.price ?? 0) < 10) continue;
      const asset = await getAsset(sym).catch(() => null);
      if (!asset?.tradable || !asset.attributes?.includes("has_options")) continue;
      if (/\b(ETF|Trust|Fund|Shares|ProShares|Direxion|iShares|Leveraged)\b/i.test(asset.name)) continue;
      out.push(sym);
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadMarketData(includeMovers: boolean): Promise<MarketData> {
  const now = Date.now();
  const clock = await getClock();
  const movers = includeMovers ? await pickMovers([...CORE, ...INDEXES]) : [];
  const symbols = [...CORE, ...movers, ...INDEXES];
  const today = etToday(now);
  const [bars, daily, snapshots] = await Promise.all([
    getBars(symbols, { timeframe: "5Min", start: `${addDays(today, -16)}T00:00:00Z`, feed: "iex", ttlMs: 20_000 }),
    // Consolidated daily history is free once it is older than 15 minutes, and only prior sessions are used.
    getDailyBars(symbols, `${addDays(today, -45)}T00:00:00Z`, "sip").catch(() => getDailyBars(symbols, `${addDays(today, -45)}T00:00:00Z`, "iex")),
    getSnapshots(symbols),
  ]);
  const series: Record<string, Series> = {};
  for (const sym of symbols) series[sym] = buildSeries(bars[sym] ?? []);
  return { clock, series, daily, snapshots, movers, fetchedAt: now };
}

export interface ScanOptions {
  settings: Settings;
  equity: number;
  cash: number;
  withOptions: boolean;
}

export interface ScanResult extends ScanSummary {
  dataAsOf: string | null;
  data: MarketData;
}

function gateFor(clock: Clock, now: number, barTime: number | null): string | null {
  if (!clock.is_open) {
    const next = new Date(clock.next_open);
    const p = etParts(next.getTime());
    const day = next.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
    return `Market closed. Opens ${day} ${formatMinutes(p.minutes)} ET.`;
  }
  const { minutes } = etParts(now);
  if (barTime == null || now - (barTime + BAR_MS) > STALE_MS) return "Intraday data is delayed, so entries are paused.";
  if (minutes < ENTRY_FROM) return "Opening range forms until 9:45 AM ET.";
  if (minutes > ENTRY_UNTIL) return "Too close to the close for new trades.";
  return null;
}

export async function scan(opts: ScanOptions, data?: MarketData): Promise<ScanResult> {
  const d = data ?? (await loadMarketData(opts.settings.includeMovers));
  const now = Date.now();
  const today = etToday(now);
  const spy = d.series.SPY;
  const qqq = d.series.QQQ;
  const signals: SymbolSignal[] = [];
  let asOf = 0;

  for (const sym of [...CORE, ...d.movers]) {
    const s = d.series[sym];
    const snap = d.snapshots[sym];
    const i = s ? lastClosedIndex(s, now) : -1;
    const bar = i >= 0 ? s.bars[i] : null;
    if (bar) asOf = Math.max(asOf, bar.t + BAR_MS);
    const liveSession = bar != null && s.session[i] === today;
    const freshTrade = snap && d.clock.is_open && now - snap.tradeTime < 5 * 60_000;
    const price = freshTrade ? snap.price : (bar?.c ?? snap?.price ?? null);
    const gate = gateFor(d.clock, now, liveSession ? bar!.t : null);
    const result =
      bar && price != null
        ? scoreAt({ s, i, price, dailyAtr: dailyAtr(d.daily[sym] ?? [], s.session[i]), spy: trendAt(spy, bar.t), qqq: trendAt(qqq, bar.t) })
        : null;
    const signal = decide(result, { minScore: opts.settings.minScore, minRR: opts.settings.minRR }, gate);
    const isCore = CORE.includes(sym);
    if (!isCore && signal.action === "WAIT") continue;
    signals.push({
      symbol: sym,
      isCore,
      price,
      changePct: price != null && snap?.prevClose ? ((price - snap.prevClose) / snap.prevClose) * 100 : null,
      action: signal.action,
      direction: signal.direction,
      score: signal.score,
      longScore: result?.long.score ?? 0,
      shortScore: result?.short.score ?? 0,
      entry: signal.plan?.entry ?? null,
      stop: signal.plan?.stop ?? null,
      target: signal.plan?.target ?? null,
      rr: signal.plan?.rr ?? null,
      reason: signal.reason,
      components: signal.components,
      option: null,
      optionReason: null,
    });
  }

  const qualified = signals.filter((s) => s.action !== "WAIT").sort((a, b) => b.score - a.score);
  if (opts.withOptions) {
    for (const sig of qualified.slice(0, 4)) {
      await attachOption(sig, opts, today, now).catch((e) => {
        sig.optionReason = e instanceof Error ? e.message : "Option data unavailable.";
      });
    }
  }
  const best = qualified.find((s) => s.option) ?? null;
  const gateMessage = signals.find((s) => s.action === "WAIT" && s.reason.startsWith("Market closed"))?.reason ?? null;
  return {
    id: null,
    at: new Date(now).toISOString(),
    marketOpen: d.clock.is_open,
    message: best ? null : (gateMessage ?? qualified[0]?.optionReason ?? (qualified.length ? null : "No setup qualifies right now.")),
    signals,
    best,
    dataAsOf: asOf ? new Date(asOf).toISOString() : null,
    data: d,
  };
}

export function priceSignal(sig: SymbolSignal, opts: ScanOptions) {
  return attachOption(sig, opts, etToday(), Date.now());
}

async function attachOption(sig: SymbolSignal, opts: ScanOptions, today: string, now: number) {
  if (sig.entry == null || sig.stop == null || sig.target == null || !sig.direction) return;
  const type = sig.direction === "long" ? "call" : "put";
  const quotes = await getOptionChain(sig.symbol, {
    type,
    expirationFrom: addDays(today, opts.settings.dteMin),
    expirationTo: addDays(today, opts.settings.dteMax),
    strikeFrom: sig.entry * 0.92,
    strikeTo: sig.entry * 1.08,
  });
  const { pick, reason } = chooseContract(
    quotes,
    { direction: sig.direction, entry: sig.entry, stop: sig.stop, target: sig.target, rr: sig.rr ?? 0 },
    {
      equity: opts.equity,
      cash: opts.cash,
      riskPct: opts.settings.riskPct,
      maxPremiumPct: opts.settings.maxPremiumPct,
      minRR: opts.settings.minRR,
      dteMin: opts.settings.dteMin,
      dteMax: opts.settings.dteMax,
      today,
      now,
    },
  );
  sig.optionReason = reason;
  if (!pick) return;
  const option: OptionSetup = {
    symbol: pick.quote.symbol,
    type,
    strike: pick.quote.strike,
    expiration: pick.quote.expiration,
    dte: pick.dte,
    contracts: pick.contracts,
    premium: pick.premium,
    bid: pick.quote.bid,
    ask: pick.quote.ask,
    delta: pick.quote.delta ?? 0,
    optionStop: pick.optionStop,
    cost: pick.cost,
    plannedRisk: pick.plannedRisk,
    plannedReward: pick.plannedReward,
    rr: pick.rr,
    quoteTime: pick.quote.quoteTime ? new Date(pick.quote.quoteTime).toISOString() : null,
  };
  sig.option = option;
}

export async function saveScan(result: ScanResult, trigger: string): Promise<number> {
  const [row] = await sql()`insert into scans (trigger, market_open, data_as_of, status, message)
    values (${trigger}, ${result.marketOpen}, ${result.dataAsOf}, 'ok', ${result.message}) returning id`;
  const id = Number(row.id);
  if (result.signals.length) {
    const payload = JSON.stringify(
      result.signals.map((s) => ({
        symbol: s.symbol,
        is_core: s.isCore,
        action: s.action,
        direction: s.direction,
        score: s.score,
        price: s.price,
        change_pct: s.changePct,
        entry: s.entry,
        stop: s.stop,
        target: s.target,
        rr: s.rr,
        reason: s.reason,
        components: { ...s.components, _long: s.longScore, _short: s.shortScore },
        option: s.option ? s.option : s.optionReason ? { reason: s.optionReason } : null,
      })),
    );
    await sql()`insert into signals (scan_id, symbol, is_core, action, direction, score, price, change_pct, entry, stop, target, rr, reason, components, option)
      select ${id}, symbol, is_core, action, direction, score, price, change_pct, entry, stop, target, rr, reason, components, option
      from jsonb_to_recordset(${payload}::jsonb) as x(symbol text, is_core boolean, action text, direction text, score int, price numeric,
        change_pct numeric, entry numeric, stop numeric, target numeric, rr numeric, reason text, components jsonb, option jsonb)`;
  }
  return id;
}

export async function latestScan(): Promise<ScanSummary & { dataAsOf: string | null }> {
  const [scanRow] = await sql()`select * from scans order by created_at desc limit 1`;
  if (!scanRow) return { id: null, at: null, marketOpen: false, message: null, signals: [], best: null, dataAsOf: null };
  const rows = await sql()`select * from signals where scan_id = ${scanRow.id} order by is_core desc, score desc`;
  const signals: SymbolSignal[] = rows.map((r) => {
    const comps = (r.components ?? null) as Record<string, number> | null;
    const opt = r.option as (OptionSetup & { reason?: string }) | null;
    const { _long, _short, ...components } = comps ?? {};
    return {
      symbol: r.symbol,
      isCore: r.is_core,
      price: numOrNull(r.price),
      changePct: numOrNull(r.change_pct),
      action: r.action,
      direction: r.direction,
      score: r.score,
      longScore: num(_long),
      shortScore: num(_short),
      entry: numOrNull(r.entry),
      stop: numOrNull(r.stop),
      target: numOrNull(r.target),
      rr: numOrNull(r.rr),
      reason: r.reason,
      components: comps && Object.keys(components).length ? (components as SymbolSignal["components"]) : null,
      option: opt && "symbol" in opt ? opt : null,
      optionReason: opt?.reason ?? null,
    };
  });
  const coreOrder = (s: SymbolSignal) => (s.isCore ? CORE.indexOf(s.symbol) : 100 - s.score);
  signals.sort((a, b) => coreOrder(a) - coreOrder(b));
  const best = signals.filter((s) => s.option && s.action !== "WAIT").sort((a, b) => b.score - a.score)[0] ?? null;
  return {
    id: Number(scanRow.id),
    at: new Date(scanRow.created_at).toISOString(),
    marketOpen: scanRow.market_open,
    message: scanRow.message,
    signals,
    best,
    dataAsOf: scanRow.data_as_of ? new Date(scanRow.data_as_of).toISOString() : null,
  };
}
