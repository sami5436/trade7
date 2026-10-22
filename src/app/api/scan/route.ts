import { findTrade } from "@/lib/server/bot";
import { alpacaConfigured } from "@/lib/server/alpaca";
import { fail, json } from "@/lib/server/http";

export const maxDuration = 60;

export async function POST() {
  if (!alpacaConfigured()) return json({ error: "Market data is not connected." }, 503);
  try {
    const result = await findTrade();
    return json({ ...result, data: undefined });
  } catch (e) {
    return fail(e);
  }
}
