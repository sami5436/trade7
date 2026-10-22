import { alpacaConfigured, getClock } from "@/lib/server/alpaca";
import { tick } from "@/lib/server/bot";
import { fail, json } from "@/lib/server/http";

export const maxDuration = 120;

// Called by the open app about once a minute. The server decides whether a pass is due:
// every 50 seconds while the market is open, every 15 minutes otherwise to keep data current.
export async function POST() {
  if (!alpacaConfigured()) return json({ ran: false, status: "idle", message: "Market data is not connected." });
  try {
    const clock = await getClock();
    return json(await tick("app", clock.is_open ? 50 : 900));
  } catch (e) {
    return fail(e);
  }
}
