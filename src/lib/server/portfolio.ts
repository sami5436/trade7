import "server-only";
import type { Portfolio, TradeRow } from "@/lib/types";
import { dayStartEquity, getAccount, listTrades, type Account } from "./store";

export function valueOf(trades: TradeRow[], account: Account) {
  let cash = account.startBalance;
  let openValue = 0;
  let realized = 0;
  for (const t of trades) {
    if (t.status === "closed") {
      realized += t.realizedPnl ?? 0;
    } else if ((t.status === "open" || t.status === "closing") && t.entryPrice != null) {
      cash -= t.entryPrice * t.qty * 100 + t.fees;
      openValue += (t.mark ?? t.entryPrice) * t.qty * 100;
    }
  }
  cash += realized;
  return { cash, openValue, realized, equity: cash + openValue };
}

export async function computePortfolio(account?: Account, trades?: TradeRow[]): Promise<Portfolio & { trades: TradeRow[] }> {
  const acct = account ?? (await getAccount());
  const all = trades ?? (await listTrades(acct.id));
  const { cash, openValue, realized, equity } = valueOf(all, acct);
  const start = await dayStartEquity(acct);
  const closed = all.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const rs = closed.filter((t) => t.plannedRisk > 0).map((t) => (t.realizedPnl ?? 0) / t.plannedRisk);
  return {
    accountId: acct.id,
    startBalance: acct.startBalance,
    startedAt: acct.startedAt,
    cash,
    equity,
    openValue,
    realized,
    dayPnl: equity - start,
    dayPnlPct: start > 0 ? ((equity - start) / start) * 100 : 0,
    totalReturnPct: ((equity - acct.startBalance) / acct.startBalance) * 100,
    closedTrades: closed.length,
    wins,
    winRate: closed.length ? wins / closed.length : null,
    avgPlannedRR: closed.length ? closed.reduce((a, t) => a + t.plannedRR, 0) / closed.length : null,
    avgR: rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null,
    trades: all,
  };
}
