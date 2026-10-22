import type { Plan } from "./engine";
import { daysBetween } from "./time";

/** Assumed regulatory and exchange fees per contract per side. Alpaca charges no commission. */
export const FEE_PER_CONTRACT = 0.03;
const MAX_CONTRACTS = 20;
const MAX_SPREAD_PCT = 0.15;
const MIN_OPEN_INTEREST = 100;
const DELTA_MIN = 0.3;
const DELTA_MAX = 0.65;
const MAX_QUOTE_AGE_MS = 30 * 60_000;

export type OptionType = "call" | "put";

export interface OptionQuote {
  symbol: string;
  type: OptionType;
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  delta: number | null;
  gamma: number | null;
  iv: number | null;
  quoteTime: number | null;
  openInterest: number | null;
}

export interface ContractPick {
  quote: OptionQuote;
  dte: number;
  contracts: number;
  premium: number;
  optionStop: number;
  lossPerContract: number;
  rewardPerContract: number;
  rr: number;
  cost: number;
  plannedRisk: number;
  plannedReward: number;
}

export interface SizingInput {
  equity: number;
  cash: number;
  riskPct: number;
  maxPremiumPct: number;
  minRR: number;
  dteMin: number;
  dteMax: number;
  today: string;
  now: number;
}

/**
 * Picks the contract with the best planned reward to risk for an underlying plan and sizes it to the risk budget.
 * Moves are projected with delta and gamma, entries pay the ask and exits are assumed to hit the bid.
 */
export function chooseContract(quotes: OptionQuote[], plan: Plan, input: SizingInput): { pick: ContractPick | null; reason: string | null } {
  const type: OptionType = plan.direction === "long" ? "call" : "put";
  const riskBudget = (input.equity * input.riskPct) / 100;
  const premiumCap = Math.min((input.equity * input.maxPremiumPct) / 100, input.cash);
  const adverse = Math.abs(plan.entry - plan.stop);
  const favorable = Math.abs(plan.target - plan.entry);

  const liquid = quotes.filter((q) => {
    if (q.type !== type || q.bid <= 0 || q.ask <= 0 || q.ask < q.bid) return false;
    const dte = daysBetween(input.today, q.expiration);
    if (dte < input.dteMin || dte > input.dteMax) return false;
    if ((q.ask - q.bid) / ((q.ask + q.bid) / 2) > MAX_SPREAD_PCT) return false;
    if (q.openInterest != null && q.openInterest < MIN_OPEN_INTEREST) return false;
    if (q.quoteTime != null && input.now - q.quoteTime > MAX_QUOTE_AGE_MS) return false;
    const d = q.delta == null ? null : Math.abs(q.delta);
    return d != null && d >= DELTA_MIN && d <= DELTA_MAX;
  });
  if (liquid.length === 0) return { pick: null, reason: "No liquid contract in the expiration window." };

  const sized: ContractPick[] = [];
  for (const q of liquid) {
    const d = Math.abs(q.delta!);
    const g = Math.max(q.gamma ?? 0, 0);
    const spread = q.ask - q.bid;
    const loss = Math.min(Math.max(d * adverse - 0.5 * g * adverse * adverse, 0) + spread, q.ask * 0.5);
    const gain = d * favorable + 0.5 * g * favorable * favorable - spread;
    const lossPerContract = loss * 100 + 2 * FEE_PER_CONTRACT;
    const rewardPerContract = gain * 100 - 2 * FEE_PER_CONTRACT;
    if (rewardPerContract <= 0) continue;
    const rr = rewardPerContract / lossPerContract;
    const byRisk = Math.floor(riskBudget / lossPerContract);
    const byCost = Math.floor(premiumCap / (q.ask * 100 + FEE_PER_CONTRACT));
    const contracts = Math.min(byRisk, byCost, MAX_CONTRACTS);
    if (contracts < 1) continue;
    sized.push({
      quote: q,
      dte: daysBetween(input.today, q.expiration),
      contracts,
      premium: q.ask,
      optionStop: round2(Math.max(q.ask - loss, 0.01)),
      lossPerContract,
      rewardPerContract,
      rr,
      cost: contracts * q.ask * 100,
      plannedRisk: contracts * lossPerContract,
      plannedReward: contracts * rewardPerContract,
    });
  }
  if (sized.length === 0) return { pick: null, reason: "Contracts cost more than the risk budget allows." };
  const qualified = sized.filter((p) => p.rr >= input.minRR);
  if (qualified.length === 0) return { pick: null, reason: "Option spreads push reward under the minimum." };
  qualified.sort((a, b) => b.rr - a.rr || Math.abs(Math.abs(a.quote.delta!) - 0.45) - Math.abs(Math.abs(b.quote.delta!) - 0.45));
  return { pick: qualified[0], reason: null };
}

export function round2(x: number) {
  return Math.round(x * 100) / 100;
}

/** Parses an OCC symbol such as NVDA251031C00185000. */
export function parseOcc(symbol: string): { root: string; expiration: string; type: OptionType; strike: number } | null {
  const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!m) return null;
  return {
    root: m[1],
    expiration: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === "C" ? "call" : "put",
    strike: Number(m[6]) / 1000,
  };
}
