import { closeAll } from "@/lib/server/bot";
import { alpacaConfigured } from "@/lib/server/alpaca";
import { fail, json } from "@/lib/server/http";
import { getAccount, listTrades, log, markCanceled, newAccount, setHalted } from "@/lib/server/store";

export const maxDuration = 60;

export async function POST() {
  try {
    if (alpacaConfigured()) await closeAll("Account reset");
    const old = await getAccount();
    // Anything the broker could not close right away is detached from the new account.
    for (const t of await listTrades(old.id, ["pending", "open", "closing"])) await markCanceled(t.id, "Account reset");
    const account = await newAccount();
    await setHalted(null);
    await log("reset", "Paper account reset to $5,000");
    return json({ ok: true, account });
  } catch (e) {
    return fail(e);
  }
}
