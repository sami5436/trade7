import { connection } from "next/server";
import { latestBacktest } from "@/lib/server/backtest-run";
import { fail, json } from "@/lib/server/http";
import { computePortfolio } from "@/lib/server/portfolio";
import { equityHistory, getAccount } from "@/lib/server/store";

export async function GET() {
  await connection();
  try {
    const account = await getAccount();
    const [pf, equity, backtest] = await Promise.all([computePortfolio(account), equityHistory(account.id), latestBacktest()]);
    const { trades, ...portfolio } = pf;
    let peak = account.startBalance;
    let maxDrawdownPct = 0;
    for (const p of equity) {
      peak = Math.max(peak, p.equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - p.equity) / peak) * 100);
    }
    return json({
      portfolio,
      maxDrawdownPct,
      equity: [{ t: Date.parse(account.startedAt), equity: account.startBalance }, ...equity],
      trades: trades.filter((t) => t.status !== "canceled" || t.entryPrice != null),
      backtest,
    });
  } catch (e) {
    return fail(e);
  }
}
