import { formatMinor, toMinor } from "@kebo/money";
import { todayIn } from "@kebo/utils";
import { date } from "@/lib/format";
import { whenText } from "@/components/notes/kinds";

export const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
export const today = () => todayIn(TZ);

/** "16 Oct" this year, "16 Oct 2025" before (writing rule 5). */
export const day = (d: string | null | undefined, now = today()) => (!d ? "—" : d.slice(0, 4) === now.slice(0, 4) ? date(d).replace(/ \d{4}$/, "") : date(d));

/** A date-only day or a moment: "4 Nov", "Yesterday"-free: "9:02" today, "28 Oct 9:02". */
export const when = (at: string, now = today()) => (at.length <= 10 ? day(at, now) : whenText(at));

/** Days between two ISO days (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "Mar 2026" */
export const monthOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: TZ });

/** Amounts per currency, added up: [{ currency, minor }]. */
export function byCurrency<T>(rows: T[], cur: (r: T) => string, amount: (r: T) => string | number | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const a = amount(r);
    if (a === null || a === undefined) continue;
    m.set(cur(r), (m.get(cur(r)) ?? 0) + toMinor(a));
  }
  return [...m.entries()].map(([currency, minor]) => ({ currency, minor }));
}

/** "USD 1,234.00 + EUR 20.00" (or the fallback when nothing). */
export const sumText = (sums: { currency: string; minor: number }[], fallback: string) =>
  sums.length ? sums.map((s) => formatMinor(s.minor, s.currency)).join(" + ") : fallback;

/** A tile's figure, rounded: "USD 186,420" (writing rule 4: tiles may round). */
export const round = (sums: { currency: string; minor: number }[], fallback: string) =>
  sums.length ? sums.map((s) => `${s.currency} ${Math.round(s.minor / 100).toLocaleString("en-US")}`).join(" + ") : fallback;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
