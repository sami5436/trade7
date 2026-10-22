import { closeAll, closeTrade } from "@/lib/server/bot";
import { fail, json } from "@/lib/server/http";
import { getAccount, listTrades } from "@/lib/server/store";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown; all?: unknown };
    if (body.all === true) {
      await closeAll("Closed by you");
      return json({ ok: true, message: "Closing all positions." });
    }
    const account = await getAccount();
    const trade = (await listTrades(account.id, ["open", "pending"])).find((t) => t.id === body.id);
    if (!trade) return json({ error: "Position not found." }, 404);
    const status = await closeTrade(trade, "Closed by you");
    return json({ ok: true, message: status === "closed" ? "Position closed." : "Exit order sent." });
  } catch (e) {
    return fail(e);
  }
}
