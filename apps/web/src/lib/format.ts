import { formatMinor, toMinor } from "@kebo/money";
import { formatDate as fmtDate, formatDateTime as fmtDateTime, timeAgo as ago, type ISODate } from "@kebo/utils";

/** Formatting for screens, in the business time zone. */
const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

export const money = (amount: string | number | null | undefined, currency: string) => (amount === null || amount === undefined ? "—" : formatMinor(toMinor(amount), currency));
export const date = (d: ISODate | Date | string | null | undefined) => fmtDate(d ?? null, TZ);
export const dateTime = (d: Date | string | null | undefined) => fmtDateTime(d ?? null, TZ);
export const timeAgo = (d: Date | string) => ago(d, TZ);
export const qty = (q: string | number) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 2 });
