/**
 * Calendar dates are plain "YYYY-MM-DD" strings (an ISO date): due dates, issue
 * dates and payment dates have no time of day, so they never shift with time
 * zones. Moments in time (created, changed) are Date objects. Functions that
 * need "today" take the business time zone as an argument, so nothing here
 * reads global state.
 */
export type ISODate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is rejected). */
export function isISODate(v: unknown): v is ISODate {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today in a time zone, e.g. todayIn("Asia/Shanghai") → "2026-10-26". */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The calendar date of a moment in a time zone. */
export const dateIn = (moment: Date, timeZone: string): ISODate => todayIn(timeZone, moment);

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatDate(value: ISODate | Date | null | undefined, timeZone = "UTC"): string {
  if (!value) return "—";
  const isDay = typeof value === "string" && value.length === 10;
  const d = typeof value === "string" ? new Date(isDay ? `${value}T00:00:00Z` : value) : value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: isDay ? "UTC" : timeZone }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(
    new Date(value),
  );
}

/** "3d 4h", "2h 5m", "45m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** "just now", "25m ago", "3h ago", "Yesterday", "4d ago", or a short date. */
export function timeAgo(value: Date | string, timeZone: string, now: Date = new Date()): string {
  const d = new Date(value);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(d);
}
