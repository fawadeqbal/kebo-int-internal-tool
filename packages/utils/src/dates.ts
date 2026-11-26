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

/** How far a time zone's clocks are ahead of UTC at a moment, in ms (Asia/Shanghai: +8 h). */
function zoneOffsetMs(moment: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(moment);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(moment.getTime() / 1000) * 1000;
}

/**
 * The moment a calendar day starts in a time zone: startOfDayIn("2026-11-01",
 * "Asia/Shanghai") → 2026-10-31T16:00:00Z. For "from this day to that day"
 * limits on timestamps, so a deal at 05:00 on the 1st in Shanghai is in November.
 */
export function startOfDayIn(date: ISODate, timeZone: string): Date {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const first = utc - zoneOffsetMs(new Date(utc), timeZone);
  // Again at the moment found, in case the offset differs there (summer time).
  return new Date(utc - zoneOffsetMs(new Date(first), timeZone));
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The same day some months later, kept inside the month it lands in: 31 Jan + 1 month → 28 Feb (29 in a leap
 * year), 30 Nov + 3 months → 28 Feb. For a warranty's end, a plan's months.
 */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* ---------------------------------------------------------------- how a company writes dates and times */

/** How a company writes a date: 14 Nov 2026 · 14/11/2026 · 11/14/2026 · 2026-11-14. */
export const DATE_FORMATS = ["d_mmm_yyyy", "dd_mm_yyyy", "mm_dd_yyyy", "yyyy_mm_dd"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** 24-hour (15:30) or 12-hour (3:30 PM). */
export const TIME_FORMATS = ["24h", "12h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** A company's time zone and how it writes dates and times: every date and time shown goes through it. */
export interface TimeStyle {
  zone: string;
  date: DateFormat;
  time: TimeFormat;
}

export const DEFAULT_DATE_FORMAT: DateFormat = "d_mmm_yyyy";
export const DEFAULT_TIME_FORMAT: TimeFormat = "24h";

/** A style from a zone alone (the usual date and time), or a full style as it is. */
const styleOf = (s: TimeStyle | string | undefined): TimeStyle =>
  typeof s === "string" || s === undefined ? { zone: s ?? "UTC", date: DEFAULT_DATE_FORMAT, time: DEFAULT_TIME_FORMAT } : s;

/** Day, month (two digits) and year of a moment in a zone. */
function partsOf(d: Date, zone: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** A day as the company writes it; `year: false` leaves the year out ("14 Nov", "14/11"). */
function dayText(d: Date, zone: string, f: DateFormat, year = true): string {
  if (f === "d_mmm_yyyy")
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      ...(year ? { year: "numeric" as const } : {}),
      timeZone: zone,
    }).format(d);
  const { day, month, year: y } = partsOf(d, zone);
  if (f === "dd_mm_yyyy") return year ? `${day}/${month}/${y}` : `${day}/${month}`;
  if (f === "mm_dd_yyyy") return year ? `${month}/${day}/${y}` : `${month}/${day}`;
  return year ? `${y}-${month}-${day}` : `${month}-${day}`;
}

/** A time of day as the company writes it: "15:30" or "3:30 PM". */
function clockText(d: Date, zone: string, t: TimeFormat): string {
  return t === "12h"
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).format(d)
    : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(d);
}

/**
 * A date: a calendar day ("2026-11-14", the same everywhere) or the day of a moment in the style's zone, written
 * the company's way. A plain zone for the second argument means the usual way (14 Nov 2026).
 */
export function formatDate(value: ISODate | Date | null | undefined, style: TimeStyle | string = "UTC"): string {
  if (!value) return "—";
  const s = styleOf(style);
  const isDay = typeof value === "string" && value.length === 10;
  const d = typeof value === "string" ? new Date(isDay ? `${value}T00:00:00Z` : value) : value;
  return dayText(d, isDay ? "UTC" : s.zone, s.date);
}

/** A day without its year ("14 Nov", "14/11"), the company's way. */
export function formatDayMonth(value: ISODate | Date | null | undefined, style: TimeStyle | string = "UTC"): string {
  if (!value) return "—";
  const s = styleOf(style);
  const isDay = typeof value === "string" && value.length === 10;
  const d = typeof value === "string" ? new Date(isDay ? `${value}T00:00:00Z` : value) : value;
  return dayText(d, isDay ? "UTC" : s.zone, s.date, false);
}

/** A moment: its day and time in the style's zone ("14 Nov 2026, 15:30"). */
export function formatDateTime(value: Date | string | null | undefined, style: TimeStyle | string): string {
  if (!value) return "—";
  const s = styleOf(style);
  const d = new Date(value);
  return `${dayText(d, s.zone, s.date)}, ${clockText(d, s.zone, s.time)}`;
}

/** The time of day of a moment in the style's zone ("15:30", "3:30 PM"). */
export function formatTime(value: Date | string | null | undefined, style: TimeStyle | string): string {
  if (!value) return "—";
  const s = styleOf(style);
  return clockText(new Date(value), s.zone, s.time);
}

/** A time of day typed as "HH:MM" (a follow-up's time), written the company's way: "15:30" or "3:30 PM". */
export function formatClock(hhmm: string | null | undefined, style: TimeStyle | string): string {
  if (!hhmm) return "";
  const s = styleOf(style);
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  if (s.time === "24h") return `${m[1]!.padStart(2, "0")}:${m[2]}`;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** The hour of the day (0–23) of a moment in a zone: "Good morning" before 12. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now));
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
export function timeAgo(value: Date | string, style: TimeStyle | string, now: Date = new Date()): string {
  const d = new Date(value);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const st = styleOf(style);
  return dayText(d, st.zone, st.date, false);
}
