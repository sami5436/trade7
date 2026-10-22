import "server-only";
import { num, numOrNull, sql } from "./db";
import type { Settings, TradeRow } from "@/lib/types";

export const DEFAULT_BALANCE = 5000;

export async function getSettings(): Promise<Settings> {
  const [r] = await sql()`select * from settings where id = 1`;
  return {
    autoTrade: r.auto_trade,
    riskPct: num(r.risk_pct),
    maxDailyLossPct: num(r.max_daily_loss_pct),
    maxPositions: r.max_positions,
    minRR: num(r.min_rr),
    minScore: r.min_score,
    exitScore: r.exit_score,
    dteMin: r.dte_min,
    dteMax: r.dte_max,
    maxPremiumPct: num(r.max_premium_pct),
    closeEod: r.close_eod,
    includeMovers: r.include_movers,
  };
}

export async function saveSettings(s: Settings) {
  await sql()`
    update settings set
      auto_trade = ${s.autoTrade}, risk_pct = ${s.riskPct}, max_daily_loss_pct = ${s.maxDailyLossPct},
      max_positions = ${s.maxPositions}, min_rr = ${s.minRR}, min_score = ${s.minScore}, exit_score = ${s.exitScore},
      dte_min = ${s.dteMin}, dte_max = ${s.dteMax}, max_premium_pct = ${s.maxPremiumPct},
      close_eod = ${s.closeEod}, include_movers = ${s.includeMovers}, updated_at = now()
    where id = 1`;
}

export interface Account {
  id: number;
  startBalance: number;
  startedAt: string;
}

export async function getAccount(): Promise<Account> {
  let [r] = await sql()`select * from accounts where active order by id desc limit 1`;
  if (!r) [r] = await sql()`insert into accounts (start_balance) values (${DEFAULT_BALANCE}) returning *`;
  return { id: r.id, startBalance: num(r.start_balance), startedAt: new Date(r.started_at).toISOString() };
}

export async function newAccount(): Promise<Account> {
  await sql()`update accounts set active = false where active`;
  const [r] = await sql()`insert into accounts (start_balance) values (${DEFAULT_BALANCE}) returning *`;
  return { id: r.id, startBalance: num(r.start_balance), startedAt: new Date(r.started_at).toISOString() };
}

function toTrade(r: Record<string, unknown>): TradeRow {
  const date = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  return {
    id: r.id as number,
    source: r.source as TradeRow["source"],
    symbol: r.symbol as string,
    direction: r.direction as TradeRow["direction"],
    optionSymbol: r.option_symbol as string,
    optionType: r.option_type as TradeRow["optionType"],
    strike: num(r.strike),
    expiration: new Date(r.expiration as string).toISOString().slice(0, 10),
    qty: r.qty as number,
    status: r.status as TradeRow["status"],
    entryOrderId: (r.entry_order_id as string) ?? null,
    exitOrderId: (r.exit_order_id as string) ?? null,
    entryLimit: numOrNull(r.entry_limit),
    entryPrice: numOrNull(r.entry_price),
    exitPrice: numOrNull(r.exit_price),
    createdAt: date(r.created_at)!,
    openedAt: date(r.opened_at),
    closedAt: date(r.closed_at),
    underlyingEntry: num(r.underlying_entry),
    underlyingStop: num(r.underlying_stop),
    underlyingTarget: num(r.underlying_target),
    optionStop: num(r.option_stop),
    plannedRisk: num(r.planned_risk),
    plannedReward: num(r.planned_reward),
    plannedRR: num(r.planned_rr),
    score: r.score as number,
    reason: r.reason as string,
    exitReason: (r.exit_reason as string) ?? null,
    fees: num(r.fees),
    realizedPnl: numOrNull(r.realized_pnl),
    mark: numOrNull(r.mark),
    markAt: date(r.mark_at),
    delta: numOrNull(r.delta),
  };
}

export async function listTrades(accountId: number, statuses?: TradeRow["status"][]): Promise<TradeRow[]> {
  const rows = statuses
    ? await sql()`select * from trades where account_id = ${accountId} and status = any(${statuses}) order by created_at desc`
    : await sql()`select * from trades where account_id = ${accountId} order by created_at desc limit 500`;
  return rows.map(toTrade);
}

export async function insertTrade(t: Omit<TradeRow, "id" | "createdAt" | "openedAt" | "closedAt" | "exitPrice" | "exitOrderId" | "exitReason" | "realizedPnl" | "markAt"> & { accountId: number }) {
  const [r] = await sql()`
    insert into trades (account_id, source, symbol, direction, option_symbol, option_type, strike, expiration, qty, status,
      entry_order_id, entry_limit, entry_price, underlying_entry, underlying_stop, underlying_target, option_stop,
      planned_risk, planned_reward, planned_rr, score, reason, fees, mark, delta)
    values (${t.accountId}, ${t.source}, ${t.symbol}, ${t.direction}, ${t.optionSymbol}, ${t.optionType}, ${t.strike},
      ${t.expiration}, ${t.qty}, ${t.status}, ${t.entryOrderId}, ${t.entryLimit}, ${t.entryPrice}, ${t.underlyingEntry},
      ${t.underlyingStop}, ${t.underlyingTarget}, ${t.optionStop}, ${t.plannedRisk}, ${t.plannedReward}, ${t.plannedRR},
      ${t.score}, ${t.reason}, ${t.fees}, ${t.mark}, ${t.delta})
    returning *`;
  return toTrade(r);
}

export async function markOpen(id: number, price: number, qty: number, fees: number) {
  await sql()`update trades set status = 'open', entry_price = ${price}, qty = ${qty}, fees = ${fees}, opened_at = now(),
    mark = coalesce(mark, ${price}), mark_at = now() where id = ${id}`;
}

export async function markCanceled(id: number, reason: string) {
  await sql()`update trades set status = 'canceled', exit_reason = ${reason}, closed_at = now() where id = ${id}`;
}

export async function markClosing(id: number, orderId: string, reason: string) {
  await sql()`update trades set status = 'closing', exit_order_id = ${orderId}, exit_reason = ${reason} where id = ${id}`;
}

export async function markReopened(id: number) {
  await sql()`update trades set status = 'open', exit_order_id = null, exit_reason = null where id = ${id}`;
}

export async function markClosed(t: TradeRow, exitPrice: number, reason: string, exitFees: number) {
  const fees = t.fees + exitFees;
  const pnl = (exitPrice - (t.entryPrice ?? 0)) * t.qty * 100 - fees;
  await sql()`update trades set status = 'closed', exit_price = ${exitPrice}, exit_reason = ${reason}, fees = ${fees},
    realized_pnl = ${pnl}, closed_at = now(), mark = ${exitPrice}, mark_at = now() where id = ${t.id}`;
}

export async function updateMark(id: number, mark: number, delta: number | null) {
  await sql()`update trades set mark = ${mark}, mark_at = now(), delta = coalesce(${delta}, delta) where id = ${id}`;
}

export async function recentlyClosed(accountId: number, minutes: number): Promise<string[]> {
  const rows = await sql()`select distinct symbol from trades where account_id = ${accountId} and status = 'closed'
    and closed_at > now() - make_interval(mins => ${minutes})`;
  return rows.map((r) => r.symbol as string);
}

export async function snapshotEquity(accountId: number, equity: number, cash: number) {
  await sql()`insert into equity_snapshots (account_id, equity, cash) values (${accountId}, ${equity}, ${cash})`;
}

/** Equity at the end of the previous ET day, or the starting balance for a new account. */
export async function dayStartEquity(account: Account): Promise<number> {
  const [r] = await sql()`select equity from equity_snapshots where account_id = ${account.id}
    and taken_at < ((now() at time zone 'America/New_York')::date::timestamp at time zone 'America/New_York')
    order by taken_at desc limit 1`;
  return r ? num(r.equity) : account.startBalance;
}

export async function equityHistory(accountId: number) {
  const rows = await sql()`
    with s as (
      select taken_at, equity, ntile(400) over (order by taken_at) as bucket
      from equity_snapshots where account_id = ${accountId}
    )
    select max(taken_at) as t, (array_agg(equity order by taken_at desc))[1] as equity from s group by bucket order by t`;
  return rows.map((r) => ({ t: new Date(r.t).getTime(), equity: num(r.equity) }));
}

export async function log(kind: string, message: string) {
  await sql()`insert into bot_log (kind, message) values (${kind}, ${message})`;
}

export async function recentLog(limit = 20) {
  const rows = await sql()`select * from bot_log order by created_at desc limit ${limit}`;
  return rows.map((r) => ({ at: new Date(r.created_at).toISOString(), kind: r.kind as string, message: r.message as string }));
}

export interface BotState {
  lastTickAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  haltedDate: string | null;
}

export async function getBotState(): Promise<BotState> {
  const [r] = await sql()`select * from bot_state where id = 1`;
  return {
    lastTickAt: r?.last_tick_at ? new Date(r.last_tick_at).toISOString() : null,
    lastStatus: r?.last_status ?? null,
    lastMessage: r?.last_message ?? null,
    haltedDate: r?.halted_date ? new Date(r.halted_date).toISOString().slice(0, 10) : null,
  };
}

export async function acquireLock(seconds: number, minGapSeconds = 0): Promise<boolean> {
  const rows = await sql()`update bot_state set lock_until = now() + make_interval(secs => ${seconds})
    where id = 1 and (lock_until is null or lock_until < now())
    and (last_tick_at is null or last_tick_at < now() - make_interval(secs => ${minGapSeconds}))
    returning id`;
  return rows.length > 0;
}

export async function releaseLock(status: string, message: string) {
  await sql()`update bot_state set lock_until = null, last_tick_at = now(), last_status = ${status}, last_message = ${message} where id = 1`;
}

export async function setHalted(date: string | null) {
  await sql()`update bot_state set halted_date = ${date} where id = 1`;
}

export async function prune() {
  await sql()`delete from scans where created_at < now() - interval '30 days'`;
  await sql()`delete from bot_log where created_at < now() - interval '30 days'`;
}
