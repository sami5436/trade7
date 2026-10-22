import { connection } from "next/server";
import { alpacaConfigured } from "@/lib/server/alpaca";
import { latestBacktest, runAndStoreBacktest } from "@/lib/server/backtest-run";
import { fail, json } from "@/lib/server/http";

export const maxDuration = 120;

export async function GET() {
  await connection();
  try {
    return json(await latestBacktest());
  } catch (e) {
    return fail(e);
  }
}

export async function POST() {
  if (!alpacaConfigured()) return json({ error: "Market data is not connected." }, 503);
  try {
    return json(await runAndStoreBacktest());
  } catch (e) {
    return fail(e);
  }
}
