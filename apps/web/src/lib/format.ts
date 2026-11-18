import { cache } from "react";
import { formatMinor, toMinor } from "@kebo/money";
import {
  formatClock,
  formatDate as fmtDate,
  formatDateTime as fmtDateTime,
  formatDayMonth,
  formatTime,
  hourIn,
  timeAgo as ago,
  todayIn,
  type ISODate,
  type TimeStyle,
} from "@kebo/utils";

/** The server's own time zone: the platform's pages (not a company's), and a company's until its time is known. */
export const SERVER_TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const SERVER_STYLE: TimeStyle = { zone: SERVER_TZ, date: "d_mmm_yyyy", time: "24h" };

/** "1 order", "3 orders"; a third word for irregular plurals ("1 inquiry", "2 inquiries"). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** How many a list shows, for its filter line: "1,204 inquiries". */
export const countOf = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export const money = (amount: string | number | null | undefined, currency: string) => (amount === null || amount === undefined ? "—" : formatMinor(toMinor(amount), currency));
/** A headline amount in whole units (KPI cards): "USD 58,140". Exact amounts stay in the tables. */
export const whole = (amount: string | number | null | undefined, currency: string) =>
  amount === null || amount === undefined ? "—" : `${currency} ${Math.round(Number(amount)).toLocaleString("en-US")}`;
/** A count of days (worked out from dates): "Same day" for 0, "1 day", "2.5 days"; none: "—". */
export const daysText = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n === 0 ? "Same day" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} day${n === 1 ? "" : "s"}`;
/** A figure tile's amount, short: "USD 159.6K", "USD 1.24M"; under 10,000 in whole units. */
export const short = (amount: string | number | null | undefined, currency: string) => {
  if (amount === null || amount === undefined) return "—";
  const v = Number(amount);
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${currency} ${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (a >= 10_000) return `${currency} ${(v / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return `${currency} ${Math.round(v).toLocaleString("en-US")}`;
};
/**
 * The company's time (Company settings › Time and dates): its zone and how it writes dates and times. Every date
 * and time on a page, and "today", goes through it; nothing else holds a time zone. Server pages: set from the
 * session (requireUser), once per request (React's cache keeps one per request). Browser: set by <CompanyTime>
 * in the app's layout; client components read it with useTime() (lib/time-client), so the server's render and
 * the browser's agree.
 */
const requestTime = cache((): { style: TimeStyle } => ({ style: SERVER_STYLE }));
let browserStyle: TimeStyle | null = null;
export function setCompanyTime(style: TimeStyle) {
  if (typeof window === "undefined") requestTime().style = style;
  else browserStyle = style;
}
/**
 * Route handlers (Excel and CSV files) run outside a React render, where React's cache keeps nothing: they set
 * the company's time with withCompanyTime (lib/route-time), which answers here.
 */
let routeStyle: () => TimeStyle | undefined = () => undefined;
export const setRouteTimeSource = (source: () => TimeStyle | undefined) => {
  routeStyle = source;
};
/** The company's zone and formats on this request. */
export const timeStyle = (): TimeStyle => (typeof window !== "undefined" ? (browserStyle ?? SERVER_STYLE) : (routeStyle() ?? requestTime().style));
/** The company's time zone. */
export const currentZone = () => timeStyle().zone;
/** Today, company time ("2026-11-15"). */
export const companyToday = () => todayIn(currentZone());
/** The hour now (0–23), company time: "Good morning" before 12. */
export const hourNow = () => hourIn(currentZone());
/** A day or a moment's day, the company's way ("14 Nov 2026", "14/11/2026"). */
export const date = (d: ISODate | Date | string | null | undefined) => fmtDate(d ?? null, timeStyle());
/** A day without its year ("14 Nov", "14/11"). */
export const dayMonth = (d: ISODate | Date | string | null | undefined) => formatDayMonth(d ?? null, timeStyle());
/**
 * A day soon, as a list says it (design "list pages" 18 Nov): "Tomorrow", "Fri 20 Nov" within the week, else
 * "24 Nov" (today and late days are said by the list itself).
 */
export const soonDay = (iso: string) => {
  const today = companyToday();
  const days = Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return `${new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${dayMonth(iso.slice(0, 10))}`;
  return dayMonth(iso.slice(0, 10));
};
/** A moment's day and time ("14 Nov 2026, 15:30" / "…, 3:30 PM"). */
export const dateTime = (d: Date | string | null | undefined) => fmtDateTime(d ?? null, timeStyle());
/** A moment's time of day ("15:30", "3:30 PM"). */
export const time = (d: Date | string | null | undefined) => formatTime(d ?? null, timeStyle());
/** A typed time of day ("15:30"), the company's way. */
export const clockTime = (hhmm: string | null | undefined) => formatClock(hhmm, timeStyle());
export const timeAgo = (d: Date | string) => ago(d, timeStyle());
export const qty = (q: string | number) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 2 });


/**
 * When an instalment falls due, as its rule says and with the date it gives now: "On the ready date (1 Apr)",
 * "14 days after shipping (15 Apr)", "On the ready date · not known yet"; a fixed one: its date.
 */
export function dueText(i: { dueOn: string | null; rule?: string | null; when?: string | null }, style: TimeStyle = timeStyle()): string {
  const rule = i.rule ? i.rule.charAt(0).toUpperCase() + i.rule.slice(1) : null;
  if (rule) return i.dueOn ? `${rule} (${formatDayMonth(i.dueOn, style)})` : `${rule} · not known yet`;
  if (i.dueOn) return fmtDate(i.dueOn, style);
  return i.when ? i.when.charAt(0).toUpperCase() + i.when.slice(1) : "No date yet";
}

/** "820 KB", "2.4 MB". */
export const fileSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** "PDF" from "quote.pdf": the little tile in front of a file's name. */
export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "FILE");
