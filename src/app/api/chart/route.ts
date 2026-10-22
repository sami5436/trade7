import { buildSeries, lastClosedIndex } from "@/lib/engine";
import { alpacaConfigured, getBars } from "@/lib/server/alpaca";
import { fail, json } from "@/lib/server/http";
import { CORE, latestScan } from "@/lib/server/scanner";
import { addDays, etToday } from "@/lib/time";

const SESSIONS_SHOWN = 2;

export async function GET(request: Request) {
  if (!alpacaConfigured()) return json({ error: "Market data is not connected." }, 503);
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return json({ error: "Unknown ticker." }, 400);
  try {
    const scan = await latestScan();
    if (!CORE.includes(symbol) && !scan.signals.some((s) => s.symbol === symbol)) return json({ error: "Ticker is not in the universe." }, 400);
    const bars = await getBars([symbol], { timeframe: "5Min", start: `${addDays(etToday(), -16)}T00:00:00Z`, feed: "iex", ttlMs: 20_000 });
    const s = buildSeries(bars[symbol] ?? []);
    const last = lastClosedIndex(s, Date.now());
    const sessions = [...new Set(s.session.slice(0, last + 1))].slice(-SESSIONS_SHOWN);
    const from = s.session.indexOf(sessions[0]);
    const range = from >= 0 ? Array.from({ length: last - from + 1 }, (_, k) => from + k) : [];
    const pick = <T,>(arr: T[]) => range.map((i) => arr[i]);
    const signal = scan.signals.find((x) => x.symbol === symbol) ?? null;
    return json({
      symbol,
      bars: pick(s.bars),
      vwap: pick(s.vwap),
      ema9: pick(s.ema9),
      ema21: pick(s.ema21),
      rsi: pick(s.rsi14),
      hist: pick(s.hist),
      signal,
      asOf: last >= 0 ? new Date(s.bars[last].t + 5 * 60_000).toISOString() : null,
    });
  } catch (e) {
    return fail(e);
  }
}
