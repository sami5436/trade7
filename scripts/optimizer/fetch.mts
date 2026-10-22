// Fetches about two years of SIP 5 minute and daily bars into $T7_DATA (default scripts/tmp) for scripts/optimize.mts.
// Usage: set -a; source .env.local; set +a; npx tsx --conditions react-server scripts/optimizer/fetch.mts
import { writeFileSync } from "node:fs";
import { etParts, isRegularSession } from "@/lib/time";

const symbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "MU", "SNDK", "WDC", "STX", "SPY", "QQQ"];
const end = new Date(Date.now() - 20 * 60_000).toISOString();
const H = { "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID!, "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY! };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BarsPage {
  bars?: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]>;
  next_page_token: string | null;
}

async function get(url: string): Promise<BarsPage> {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(url, { headers: H });
    if (r.status === 429) { await sleep(15000); continue; }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()) as BarsPage;
  }
  throw new Error("too many 429");
}

async function series(sym: string, timeframe: string, start: string) {
  const out: number[][] = [];
  let token: string | null = null;
  do {
    const q = new URLSearchParams({ symbols: sym, timeframe, start, end, limit: "10000", feed: "sip", adjustment: "split", sort: "asc" });
    if (token) q.set("page_token", token);
    const res = await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for (const b of res.bars?.[sym] ?? []) out.push([Date.parse(b.t), b.o, b.h, b.l, b.c, b.v]);
    token = res.next_page_token;
    await sleep(350);
  } while (token);
  return out;
}

const bars: Record<string, number[][]> = {};
const daily: Record<string, { date: string; o: number; h: number; l: number; c: number }[]> = {};
for (const s of symbols) {
  bars[s] = (await series(s, "5Min", "2024-10-01T00:00:00Z")).filter((b) => isRegularSession(b[0]));
  daily[s] = (await series(s, "1Day", "2024-06-01T00:00:00Z")).map((b) => ({ date: etParts(b[0]).date, o: b[1], h: b[2], l: b[3], c: b[4] }));
  console.log(s, bars[s].length, daily[s].length);
}
writeFileSync(`${process.env.T7_DATA ?? "scripts/tmp"}/bars5.json`, JSON.stringify(bars));
writeFileSync(`${process.env.T7_DATA ?? "scripts/tmp"}/daily.json`, JSON.stringify(daily));
