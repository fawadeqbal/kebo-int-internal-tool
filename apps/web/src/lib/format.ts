import { formatMinor, toMinor } from "@kebo/money";
import { formatDate as fmtDate, formatDateTime as fmtDateTime, timeAgo as ago, type ISODate } from "@kebo/utils";

/** The business time zone: every date on a screen, and "today", is in it. The one definition. */
export const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/** "1 order", "3 orders"; a third word for irregular plurals ("1 inquiry", "2 inquiries"). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const money = (amount: string | number | null | undefined, currency: string) => (amount === null || amount === undefined ? "—" : formatMinor(toMinor(amount), currency));
/** A headline amount in whole units (KPI cards): "USD 58,140". Exact amounts stay in the tables. */
export const whole = (amount: string | number | null | undefined, currency: string) =>
  amount === null || amount === undefined ? "—" : `${currency} ${Math.round(Number(amount)).toLocaleString("en-US")}`;
export const date = (d: ISODate | Date | string | null | undefined) => fmtDate(d ?? null, TZ);
export const dateTime = (d: Date | string | null | undefined) => fmtDateTime(d ?? null, TZ);
export const timeAgo = (d: Date | string) => ago(d, TZ);
export const qty = (q: string | number) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "1 Apr" (a calendar day, no year). */
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * When an instalment falls due, as its rule says and with the date it gives now: "On the ready date (1 Apr)",
 * "14 days after shipping (15 Apr)", "On the ready date · not known yet"; a fixed one: its date.
 */
export function dueText(i: { dueOn: string | null; rule?: string | null; when?: string | null }): string {
  const rule = i.rule ? i.rule.charAt(0).toUpperCase() + i.rule.slice(1) : null;
  if (rule) return i.dueOn ? `${rule} (${dayMonth(i.dueOn)})` : `${rule} · not known yet`;
  if (i.dueOn) return date(i.dueOn);
  return i.when ? i.when.charAt(0).toUpperCase() + i.when.slice(1) : "No date yet";
}
