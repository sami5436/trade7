import type { Action, Components, Direction } from "./engine";

export interface Settings {
  autoTrade: boolean;
  riskPct: number;
  maxDailyLossPct: number;
  maxPositions: number;
  minRR: number;
  minScore: number;
  exitScore: number;
  dteMin: number;
  dteMax: number;
  maxPremiumPct: number;
  closeEod: boolean;
  includeMovers: boolean;
}

export interface TradeRow {
  id: number;
  source: "auto" | "manual";
  symbol: string;
  direction: Direction;
  optionSymbol: string;
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  qty: number;
  status: "pending" | "open" | "closing" | "closed" | "canceled";
  entryOrderId: string | null;
  exitOrderId: string | null;
  entryLimit: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
  underlyingEntry: number;
  underlyingStop: number;
  underlyingTarget: number;
  optionStop: number;
  plannedRisk: number;
  plannedReward: number;
  plannedRR: number;
  score: number;
  reason: string;
  exitReason: string | null;
  fees: number;
  realizedPnl: number | null;
  mark: number | null;
  markAt: string | null;
  delta: number | null;
}

export interface OptionSetup {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  dte: number;
  contracts: number;
  premium: number;
  bid: number;
  ask: number;
  delta: number;
  optionStop: number;
  cost: number;
  plannedRisk: number;
  plannedReward: number;
  rr: number;
  quoteTime: string | null;
}

export interface SymbolSignal {
  symbol: string;
  isCore: boolean;
  price: number | null;
  changePct: number | null;
  action: Action;
  direction: Direction | null;
  score: number;
  longScore: number;
  shortScore: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  reason: string;
  components: Components | null;
  option: OptionSetup | null;
  optionReason: string | null;
}

export interface Portfolio {
  accountId: number;
  startBalance: number;
  startedAt: string;
  cash: number;
  equity: number;
  openValue: number;
  realized: number;
  dayPnl: number;
  dayPnlPct: number;
  totalReturnPct: number;
  closedTrades: number;
  wins: number;
  winRate: number | null;
  avgPlannedRR: number | null;
  avgR: number | null;
}

export interface Freshness {
  stocks: string;
  options: string;
  asOf: string | null;
  stale: boolean;
}

export interface ScanSummary {
  id: number | null;
  at: string | null;
  marketOpen: boolean;
  message: string | null;
  signals: SymbolSignal[];
  best: SymbolSignal | null;
}

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
}

export interface AppState {
  configured: { data: boolean; db: boolean };
  portfolio: Portfolio;
  positions: TradeRow[];
  settings: Settings;
  scan: ScanSummary;
  clock: MarketClock | null;
  freshness: Freshness;
  bot: { lastTickAt: string | null; lastStatus: string | null; lastMessage: string | null; halted: boolean };
  log: { at: string; kind: string; message: string }[];
}
