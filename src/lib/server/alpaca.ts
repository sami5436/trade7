import "server-only";
import type { DailyBar } from "@/lib/engine";
import type { Bar } from "@/lib/indicators";
import type { OptionQuote, OptionType } from "@/lib/options";
import { etParts } from "@/lib/time";

// Paper trading only. There is intentionally no live trading endpoint in this codebase.
const TRADING = "https://paper-api.alpaca.markets";
const DATA = "https://data.alpaca.markets";

export class AlpacaError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function alpacaConfigured(): boolean {
  return Boolean(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
}

const memo = new Map<string, { at: number; value: unknown }>();

async function request<T>(base: string, path: string, init: RequestInit & { ttlMs?: number } = {}): Promise<T> {
  if (!alpacaConfigured()) throw new AlpacaError("Market data is not connected.", 401);
  const url = `${base}${path}`;
  const method = init.method ?? "GET";
  const cacheKey = method === "GET" && init.ttlMs ? url : null;
  if (cacheKey) {
    const hit = memo.get(cacheKey);
    if (hit && Date.now() - hit.at < init.ttlMs!) return hit.value as T;
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID!,
        "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY!,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (res.status === 429 && attempt < 2) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const wait = reset ? Math.min(Math.max(reset * 1000 - Date.now(), 500), 5000) : 1500;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = body;
      try {
        message = JSON.parse(body).message ?? body;
      } catch {}
      throw new AlpacaError(message || `Alpaca request failed (${res.status})`, res.status);
    }
    const value = res.status === 204 ? (null as T) : ((await res.json()) as T);
    if (cacheKey) {
      if (memo.size > 500) memo.clear();
      memo.set(cacheKey, { at: Date.now(), value });
    }
    return value;
  }
}

/* Trading */

export interface Clock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export const getClock = () => request<Clock>(TRADING, "/v2/clock", { ttlMs: 20_000 });

export interface AlpacaOrder {
  id: string;
  status: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  side: "buy" | "sell";
}

export function submitOptionOrder(o: { symbol: string; qty: number; side: "buy" | "sell"; limit?: number }) {
  return request<AlpacaOrder>(TRADING, "/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: o.symbol,
      qty: String(o.qty),
      side: o.side,
      type: o.limit ? "limit" : "market",
      ...(o.limit ? { limit_price: o.limit.toFixed(2) } : {}),
      time_in_force: "day",
      position_intent: o.side === "buy" ? "buy_to_open" : "sell_to_close",
    }),
  });
}

export const getOrder = (id: string) => request<AlpacaOrder>(TRADING, `/v2/orders/${id}`);

export async function cancelOrder(id: string) {
  try {
    await request(TRADING, `/v2/orders/${id}`, { method: "DELETE" });
  } catch (e) {
    // 422 means the order is already filled or closed.
    if (!(e instanceof AlpacaError && (e.status === 422 || e.status === 404))) throw e;
  }
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
}

export const getPositions = () => request<AlpacaPosition[]>(TRADING, "/v2/positions");

interface Asset {
  symbol: string;
  name: string;
  tradable: boolean;
  attributes?: string[];
}

export const getAsset = (symbol: string) => request<Asset>(TRADING, `/v2/assets/${encodeURIComponent(symbol)}`, { ttlMs: 6 * 3600_000 });

/* Stock data. Live reads use the free IEX feed, which is real time but only covers IEX volume. */

interface RawBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const BAR_PAGE_CAP = 100;
const BAR_CONCURRENCY = 6;

async function barsFor(
  symbol: string,
  opts: { timeframe: "5Min" | "1Day"; start: string; end?: string; feed: "iex" | "sip"; ttlMs?: number },
): Promise<Bar[]> {
  const out: Bar[] = [];
  let token: string | null = null;
  for (let page = 0; page < BAR_PAGE_CAP; page++) {
    const q = new URLSearchParams({
      symbols: symbol,
      timeframe: opts.timeframe,
      start: opts.start,
      limit: "10000",
      feed: opts.feed,
      adjustment: "split",
      sort: "asc",
    });
    if (opts.end) q.set("end", opts.end);
    if (token) q.set("page_token", token);
    const res: { bars: Record<string, RawBar[]> | null; next_page_token: string | null } = await request(DATA, `/v2/stocks/bars?${q}`, {
      ttlMs: opts.ttlMs,
    });
    for (const b of res.bars?.[symbol] ?? []) out.push({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    token = res.next_page_token;
    if (!token) return out;
  }
  // Never return a silently truncated history.
  throw new AlpacaError(`Bar history for ${symbol} exceeded ${BAR_PAGE_CAP} pages`, 500);
}

/** Fetches each symbol separately so one busy symbol cannot crowd others out of shared pages. */
export async function getBars(
  symbols: string[],
  opts: { timeframe: "5Min" | "1Day"; start: string; end?: string; feed: "iex" | "sip"; ttlMs?: number },
): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  const queue = [...symbols];
  await Promise.all(
    Array.from({ length: Math.min(BAR_CONCURRENCY, queue.length) }, async () => {
      for (let sym = queue.shift(); sym; sym = queue.shift()) out[sym] = await barsFor(sym, opts);
    }),
  );
  return out;
}

export async function getDailyBars(symbols: string[], start: string, feed: "iex" | "sip"): Promise<Record<string, DailyBar[]>> {
  const bars = await getBars(symbols, { timeframe: "1Day", start, feed, ttlMs: 30 * 60_000 });
  const out: Record<string, DailyBar[]> = {};
  for (const [sym, list] of Object.entries(bars)) {
    out[sym] = list.map((b) => ({ date: etParts(b.t).date, o: b.o, h: b.h, l: b.l, c: b.c }));
  }
  return out;
}

export interface StockSnapshot {
  price: number;
  tradeTime: number;
  prevClose: number | null;
}

export async function getSnapshots(symbols: string[]): Promise<Record<string, StockSnapshot>> {
  const q = new URLSearchParams({ symbols: symbols.join(","), feed: "iex" });
  const res = await request<
    Record<string, { latestTrade?: { p: number; t: string }; dailyBar?: { c: number }; prevDailyBar?: { c: number } } | null>
  >(DATA, `/v2/stocks/snapshots?${q}`, { ttlMs: 10_000 });
  const out: Record<string, StockSnapshot> = {};
  for (const [sym, s] of Object.entries(res)) {
    if (!s?.latestTrade) continue;
    out[sym] = { price: s.latestTrade.p, tradeTime: Date.parse(s.latestTrade.t), prevClose: s.prevDailyBar?.c ?? null };
  }
  return out;
}

export async function getMostActive(top = 20): Promise<string[]> {
  const res = await request<{ most_actives: { symbol: string }[] }>(DATA, `/v1beta1/screener/stocks/most-actives?by=volume&top=${top}`, {
    ttlMs: 10 * 60_000,
  });
  return res.most_actives.map((m) => m.symbol);
}

/* Options data. The free indicative feed is derived from OPRA: quotes are modified and trades are delayed. */

interface RawOptionSnapshot {
  latestQuote?: { ap: number; bp: number; t: string };
  greeks?: { delta: number; gamma: number };
  impliedVolatility?: number;
}

function toQuote(symbol: string, s: RawOptionSnapshot, oi: number | null): OptionQuote | null {
  const m = /^([A-Z.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!m || !s.latestQuote) return null;
  return {
    symbol,
    type: (m[5] === "C" ? "call" : "put") as OptionType,
    strike: Number(m[6]) / 1000,
    expiration: `20${m[2]}-${m[3]}-${m[4]}`,
    bid: s.latestQuote.bp,
    ask: s.latestQuote.ap,
    delta: s.greeks?.delta ?? null,
    gamma: s.greeks?.gamma ?? null,
    iv: s.impliedVolatility ?? null,
    quoteTime: s.latestQuote.t ? Date.parse(s.latestQuote.t) : null,
    openInterest: oi,
  };
}

export async function getOptionChain(
  underlying: string,
  opts: { type: OptionType; expirationFrom: string; expirationTo: string; strikeFrom: number; strikeTo: number },
): Promise<OptionQuote[]> {
  const filters = {
    type: opts.type,
    expiration_date_gte: opts.expirationFrom,
    expiration_date_lte: opts.expirationTo,
    strike_price_gte: opts.strikeFrom.toFixed(2),
    strike_price_lte: opts.strikeTo.toFixed(2),
  };
  const contracts = await request<{ option_contracts: { symbol: string; open_interest: string | null; tradable: boolean }[] }>(
    TRADING,
    `/v2/options/contracts?${new URLSearchParams({ underlying_symbols: underlying, status: "active", limit: "1000", ...filters })}`,
    { ttlMs: 30 * 60_000 },
  );
  const oi = new Map(contracts.option_contracts.filter((c) => c.tradable).map((c) => [c.symbol, c.open_interest ? Number(c.open_interest) : null]));

  const quotes: OptionQuote[] = [];
  let token: string | null = null;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ feed: "indicative", limit: "1000", ...filters });
    if (token) q.set("page_token", token);
    const res: { snapshots: Record<string, RawOptionSnapshot>; next_page_token: string | null } = await request(
      DATA,
      `/v1beta1/options/snapshots/${encodeURIComponent(underlying)}?${q}`,
      { ttlMs: 15_000 },
    );
    for (const [sym, snap] of Object.entries(res.snapshots ?? {})) {
      if (!oi.has(sym)) continue;
      const quote = toQuote(sym, snap, oi.get(sym) ?? null);
      if (quote) quotes.push(quote);
    }
    token = res.next_page_token;
    if (!token) break;
  }
  return quotes;
}

export async function getOptionQuotes(symbols: string[]): Promise<Record<string, OptionQuote>> {
  if (symbols.length === 0) return {};
  const q = new URLSearchParams({ symbols: symbols.join(","), feed: "indicative" });
  const res = await request<{ snapshots: Record<string, RawOptionSnapshot> }>(DATA, `/v1beta1/options/snapshots?${q}`, { ttlMs: 10_000 });
  const out: Record<string, OptionQuote> = {};
  for (const [sym, snap] of Object.entries(res.snapshots ?? {})) {
    const quote = toQuote(sym, snap, null);
    if (quote) out[sym] = quote;
  }
  return out;
}
