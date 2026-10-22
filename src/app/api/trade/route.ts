import { manualTrade } from "@/lib/server/bot";
import { alpacaConfigured } from "@/lib/server/alpaca";
import { fail, json } from "@/lib/server/http";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!alpacaConfigured()) return json({ error: "Market data is not connected." }, 503);
  try {
    const body = (await request.json().catch(() => ({}))) as { symbol?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    if (!/^[A-Z.]{1,6}$/.test(symbol)) return json({ error: "Pick a ticker first." }, 400);
    const result = await manualTrade(symbol);
    return json(result, result.ok ? 200 : 409);
  } catch (e) {
    return fail(e);
  }
}
