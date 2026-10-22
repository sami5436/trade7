const ET = "America/New_York";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

export interface EtParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since midnight ET
  weekday: number; // 0 Sunday ... 6 Saturday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Bars arrive on 5 minute boundaries, so cache by the minute to keep large loops fast.
const cache = new Map<number, EtParts>();

export function etParts(ms: number): EtParts {
  const key = Math.floor(ms / 60_000);
  const hit = cache.get(key);
  if (hit) return hit;
  const p: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(key * 60_000))) p[part.type] = part.value;
  const result: EtParts = {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
  if (cache.size > 200_000) cache.clear();
  cache.set(key, result);
  return result;
}

export const MARKET_OPEN_MIN = 9 * 60 + 30;
export const MARKET_CLOSE_MIN = 16 * 60;

export function isRegularSession(ms: number): boolean {
  const { minutes, weekday } = etParts(ms);
  return weekday >= 1 && weekday <= 5 && minutes >= MARKET_OPEN_MIN && minutes < MARKET_CLOSE_MIN;
}

export function etToday(now = Date.now()): string {
  return etParts(now).date;
}

/** Calendar days from an ET date (YYYY-MM-DD) to another. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}
