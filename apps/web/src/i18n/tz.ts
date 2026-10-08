// Time zone preference + calendar-day math in an IANA zone, using only Intl (no tz database dep).
// Shared by server and client code, so keep it free of next/* imports.

export const TZ_COOKIE = "tz";
export const DEFAULT_TZ = "Asia/Bangkok";

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function wallParts(ms: number, tz: string) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFmt.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, s: p.second };
}

// Offset of `tz` from UTC at instant `ms`, in ms (Bangkok → +7h, New York → −4h/−5h).
export function tzOffsetMs(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

// Wall-clock time in `tz` as if it were UTC (for Excel cells, which have no zone).
export const toWallClock = (ms: number, tz: string) => new Date(ms + tzOffsetMs(ms, tz));

// "UTC+07:00", "UTC−05:00", "UTC".
export function tzOffsetLabel(tz: string, at = Date.now()): string {
  const m = Math.round(tzOffsetMs(at, tz) / 60000);
  if (!m) return "UTC";
  const a = Math.abs(m), p = (n: number) => String(n).padStart(2, "0");
  return `UTC${m < 0 ? "−" : "+"}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);

// Calendar day ("YYYY-MM-DD") of instant `ms` in `tz`.
export function dayIn(ms: number | string | Date, tz: string): string {
  const p = wallParts(new Date(ms).getTime(), tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// "YYYY-MM-DD" plus n days (pure calendar math).
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Instant (ms) of local midnight starting `day` in `tz`. Handles DST: the offset is
// re-read at the first guess, so days that are 23h/25h long still get the right start.
export function dayStartMs(day: string, tz: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const o1 = tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
  const t = guess - o1;
  // If midnight does not exist (spring-forward at 00:00), wallParts lands after it; that is the day's start.
  return tzOffsetMs(t, tz) === o1 ? t : guess - tzOffsetMs(t, tz);
}

// ISO instants for the start / last millisecond of a calendar day in `tz` ("" for no day).
export const dayStartIso = (day: string, tz: string) => (isDay(day) ? new Date(dayStartMs(day, tz)).toISOString() : "");
export const dayEndIso = (day: string, tz: string) => (isDay(day) ? new Date(dayStartMs(addDays(day, 1), tz) - 1).toISOString() : "");

// Range of the last n calendar days in `tz`, today included: first/last day and the start instant.
export function lastDays(n: number, tz: string, now = Date.now()) {
  const to = dayIn(now, tz), from = addDays(to, -(n - 1));
  return { from, to, startIso: dayStartIso(from, tz) };
}
