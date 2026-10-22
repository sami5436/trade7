const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "N/A" : usd.format(x);
}

export function signedMoney(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "N/A";
  const s = usd.format(Math.abs(x));
  return x > 0.004 ? `+${s}` : x < -0.004 ? `−${s}` : s;
}

export function pct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "N/A";
  const s = Math.abs(x).toFixed(digits);
  return x > 0.0049 ? `+${s}%` : x < -0.0049 ? `−${s}%` : `${s}%`;
}

export function price(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "N/A" : `$${x.toFixed(2)}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function dateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function contractLabel(o: { strike: number; type: "call" | "put"; expiration: string }): string {
  return `$${o.strike % 1 === 0 ? o.strike.toFixed(0) : o.strike.toFixed(2)} ${o.type.toUpperCase()}  ${shortDate(o.expiration)}`;
}

export function strategyName(type: "call" | "put"): string {
  return type === "call" ? "LONG CALL" : "LONG PUT";
}

/** Plain order description, for example "Buy to open 2 NVDA $220 calls, expiring Oct 28 (7 days)". */
export function orderText(symbol: string, o: { contracts: number; strike: number; type: "call" | "put"; expiration: string; dte?: number }): string {
  const strike = o.strike % 1 === 0 ? o.strike.toFixed(0) : o.strike.toFixed(2);
  const kind = o.contracts === 1 ? o.type : `${o.type}s`;
  const days = o.dte != null ? ` (${o.dte} ${o.dte === 1 ? "day" : "days"})` : "";
  return `Buy to open ${o.contracts} ${symbol} $${strike} ${kind}, expiring ${shortDate(o.expiration)}${days}`;
}
