import { addDays, daysBetween, monthEnd, monthStart } from "@kebo/utils";

/** Insights' sections, in the order of the list on the left. */
export const SECTIONS = ["overview", "money", "customers", "factories", "cash", "people", "funnel"] as const;
export type Section = (typeof SECTIONS)[number];

export const PERIOD_KINDS = ["month", "quarter", "year", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const PERIOD_LABEL: Record<PeriodKind, string> = { month: "Month", quarter: "Quarter", year: "Year", custom: "Custom" };
/** How many months each quick period spans, ending with this month. */
const MONTHS: Record<Exclude<PeriodKind, "custom">, number> = { month: 1, quarter: 3, year: 12 };

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
  /** The span just before, as long. */
  prevFrom: string;
  prevTo: string;
  /** "1 Sep – 30 Nov 2026" */
  label: string;
  /** "Jun – Aug" */
  vsLabel: string;
  /** "this quarter", "this month", "these 12 months", "1 Sep – 30 Nov" */
  name: string;
}

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Short month names ("Sep", not the "Sept" some browsers give). */
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov" for "2026-11". */
export const monthShortOf = (ym: string) => MONTH_SHORT[Number(ym.slice(5, 7)) - 1] ?? ym;
/** "Nov 2026" for "2026-11". */
export const monthYearOf = (ym: string) => `${monthShortOf(ym)} ${ym.slice(0, 4)}`;

/** A date in parts: { day: true, month: true, year: true } → "1 Sep 2026". */
const fmt = (iso: string, opts: { day?: unknown; month?: unknown; year?: unknown }) =>
  [opts.day ? String(Number(iso.slice(8, 10))) : null, opts.month ? monthShortOf(iso) : null, opts.year ? iso.slice(0, 4) : null]
    .filter(Boolean)
    .join(" ");

/** "1 Sep – 30 Nov 2026", "1–30 Nov 2026", "1 Dec 2025 – 30 Nov 2026". */
export function spanLabel(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${fmt(from, { day: "numeric" })}–${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${fmt(from, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "Oct", "Jun – Aug", "Dec 2024 – Nov 2025" for whole months; days otherwise. */
function shortSpan(from: string, to: string): string {
  const whole = from.slice(8) === "01" && to === monthEnd(to);
  if (!whole) return spanLabel(from, to);
  if (from.slice(0, 7) === to.slice(0, 7)) return fmt(from, { month: "short" });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  // A whole year says which: "Jan – Dec 2025".
  if (sameYear && from.slice(5, 7) === "01" && to.slice(5, 7) === "12") return `Jan – Dec ${from.slice(0, 4)}`;
  return sameYear
    ? `${fmt(from, { month: "short" })} – ${fmt(to, { month: "short" })}`
    : `${fmt(from, { month: "short", year: "numeric" })} – ${fmt(to, { month: "short", year: "numeric" })}`;
}

/**
 * The period every figure on the page is for, and the one it is compared with: this month, this calendar quarter
 * or year, or your own dates (compared with as many days just before). Quarter by default.
 */
export function periodOf(q: { period?: string; from?: string; to?: string }, today: string): Period {
  let kind: PeriodKind = (PERIOD_KINDS as readonly string[]).includes(q.period ?? "") ? (q.period as PeriodKind) : "quarter";
  if (kind === "custom" && !(isDay(q.from) && isDay(q.to) && q.from! <= q.to!)) kind = "quarter";
  if (kind === "custom") {
    const from = q.from!;
    const to = q.to!;
    const days = daysBetween(from, to) + 1;
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    return {
      kind,
      from,
      to,
      prevFrom,
      prevTo,
      label: spanLabel(from, to),
      vsLabel: shortSpan(prevFrom, prevTo),
      name: spanLabel(from, to),
    };
  }
  // Calendar periods (review 24 Nov, M-30: Quarter and Year were the last 3 and 12 months): this month, this
  // quarter (Oct–Dec), this year (Jan–Dec), each against the whole one before it.
  const n = MONTHS[kind];
  const month = Number(today.slice(5, 7));
  const back = kind === "month" ? 0 : kind === "quarter" ? (month - 1) % 3 : month - 1;
  const from = monthStart(today, -back);
  const to = monthEnd(monthStart(from, n - 1));
  const prevFrom = monthStart(from, -n);
  const prevTo = addDays(from, -1);
  const name = kind === "month" ? "this month" : kind === "quarter" ? "this quarter" : "this year";
  return { kind, from, to, prevFrom, prevTo, label: spanLabel(from, to), vsLabel: shortSpan(prevFrom, prevTo), name };
}

/** The change from `before` to `now` in percent (null when there was nothing before). */
export function change(now: number, before: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

/** Old links (?tab=…) to the new sections. */
export function sectionOfTab(tab?: string): { section: Section; view?: string } | null {
  switch (tab) {
    case "sales":
      return { section: "funnel" };
    case "customers":
      return { section: "customers" };
    case "factories":
      return { section: "factories" };
    case "profit":
      return { section: "money" };
    case "targets":
      return { section: "people", view: "targets" };
    case "overview":
      return { section: "overview" };
    default:
      return null;
  }
}

/** "63k", "1.2M": an amount in a list or on an axis (the exact one is in the table and Excel). */
export const compact = (v: number) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v).replace("K", "k");
/** "USD 63k" */
export const compactMoney = (v: number | null | undefined, c: string) => (v === null || v === undefined ? "—" : `${c} ${compact(v)}`);
/** "USD 288,000" (whole units); from a million "USD 1.21M". */
export function bigMoney(v: number | null | undefined, c: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  // One shape for a negative amount: "− USD 1,250" (as lib/format's money and whole).
  if (v < 0) return `− ${bigMoney(-v, c)}`;
  // Whole units up to ten million, so a row of figures reads one way ("USD 1,150,000" beside "USD 231,293", not
  // "USD 1.15M": review 24 Nov, M-33); only beyond that, millions.
  if (Math.abs(v) >= 10_000_000) return `${c} ${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  return `${c} ${Math.round(v).toLocaleString("en-US")}`;
}
/** "1,234" (whole units) for table cells in the main currency named in the header. */
export const amountCell = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"));
/** "13.6%" */
export const percent = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
