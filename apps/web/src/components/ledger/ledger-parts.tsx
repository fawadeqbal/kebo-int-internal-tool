import Link from "next/link";
import type { ReactNode } from "react";
import { CURRENCIES, LEDGER_ENTRY_TYPE_LABEL, LEDGER_ENTRY_TYPES, type LedgerEntryType, type LedgerPartyKind } from "@kebo/shared";
import { Badge, buildHref, cn, FilterChip } from "@kebo/ui";
import { AutoSelect } from "@kebo/ui/client";
import { addDays } from "@kebo/utils";
import { date, money } from "@/lib/format";
import type { AgeingBucketView, LedgerListRow } from "@/lib/types-ledger";

/* ---------------------------------------------------------------- what a row is */

const TONE: Record<string, "info" | "ok" | "warn" | "bad" | "neutral"> = {
  order: "info",
  purchase_order: "info",
  money_in: "ok",
  money_out: "warn",
  correction: "bad",
};

/** An entry's type as a badge (its words, never colour alone). */
export function TypeBadge({ type }: { type: string }) {
  return <Badge tone={TONE[type] ?? "neutral"}>{LEDGER_ENTRY_TYPE_LABEL[type as LedgerEntryType] ?? type}</Badge>;
}

/** "1,000.00" (an amount in the main currency, with its sign). */
export const amount = (v: number) =>
  (v < 0 ? "−" : "") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "CNY 62,715.00 @ 7.10" when it was recorded in another currency than the main one, else the currency. */
export function asRecorded(r: { currency: string; debit: string; credit: string; rate: number | null }, main: string) {
  if (r.currency === main) return r.currency;
  const v = Number(r.debit) || Number(r.credit);
  return `${money(v, r.currency)}${r.rate ? ` @ ${Number(r.rate.toFixed(4))}` : ""}`;
}

/** The parties' ledger pages: /finance/ledger/customers/<id>, …/factories/<id>, …/staff/<id>. */
export const PARTY_PATH: Record<LedgerPartyKind, string> = { customer: "customers", factory: "factories", staff: "staff" };
export const partyHref = (kind: LedgerPartyKind, id: string) => `/finance/ledger/${PARTY_PATH[kind]}/${id}`;

/* ---------------------------------------------------------------- the period */

export const PERIODS = [
  { key: "recent", label: "Since last month" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "last-year", label: "Last year" },
  { key: "all", label: "All time" },
] as const;

const first = (d: string) => `${d.slice(0, 8)}01`;
const prevMonth = (d: string) => first(addDays(first(d), -1));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The days a period covers (custom: ?from&to), and its words ("1 Oct – 4 Nov 2026"). */
export function periodOf(sp: { period?: string; from?: string; to?: string }, today: string) {
  if (sp.from && DAY.test(sp.from) && (!sp.to || DAY.test(sp.to))) {
    const to = sp.to ?? today;
    return { key: "custom", from: sp.from, to, label: span(sp.from, to) };
  }
  const key = PERIODS.some((p) => p.key === sp.period) ? sp.period! : "recent";
  const y = today.slice(0, 4);
  const range =
    key === "month"
      ? { from: first(today), to: today }
      : key === "last-month"
        ? { from: prevMonth(today), to: addDays(first(today), -1) }
        : key === "year"
          ? { from: `${y}-01-01`, to: today }
          : key === "last-year"
            ? { from: `${Number(y) - 1}-01-01`, to: `${Number(y) - 1}-12-31` }
            : key === "all"
              ? { from: "2000-01-01", to: today }
              : { from: prevMonth(today), to: today };
  return { key, ...range, label: key === "all" ? "All time" : span(range.from, range.to) };
}

const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "1 Oct – 4 Nov 2026". */
export function span(from: string, to: string) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  return `${from.slice(0, 4) === to.slice(0, 4) ? SHORT.format(f) : LONG.format(f)} – ${LONG.format(t)}`;
}

/** "04 Nov" for this year's days, "04 Nov 2025" for another's. */
export const day = (d: string, today: string) => (d.slice(0, 4) === today.slice(0, 4) ? date(d).replace(/ \d{4}$/, "") : date(d));

/* ---------------------------------------------------------------- filters */

/**
 * The filters above the entries: the period, the type, the currency (selects that apply themselves) and
 * "Show removed". `keep`: the view's other parameters, carried along.
 */
export function LedgerFilters({
  path,
  sp,
  period,
  keep,
  types = true,
  removedChip = true,
  end,
}: {
  path: string;
  sp: Record<string, string | undefined>;
  period: { key: string; label: string };
  keep: Record<string, string | undefined>;
  types?: boolean;
  /** "Show removed" (on by default; ?removed=0 hides them). */
  removedChip?: boolean;
  end?: ReactNode;
}) {
  const removed = removedChip && sp.removed !== "0";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <form
        className="flex flex-wrap items-center gap-1.5 [&_select]:h-8 [&_select]:rounded-full [&_select]:border-line-strong [&_select]:text-xs [&_select]:font-medium"
        aria-label="Filter the ledger"
      >
        {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {removedChip
          ? !removed && <input type="hidden" name="removed" value="0" />
          : sp.removed && <input type="hidden" name="removed" value={sp.removed} />}
        <AutoSelect name="period" defaultValue={period.key === "custom" ? "" : period.key} aria-label="Period" className="w-auto">
          {period.key === "custom" && <option value="">{period.label}</option>}
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key === "recent" && period.key === "recent" ? period.label : p.label}
            </option>
          ))}
        </AutoSelect>
        {types && (
          <AutoSelect name="type" defaultValue={sp.type ?? ""} aria-label="Type" className="w-auto">
            <option value="">All types</option>
            {LEDGER_ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEDGER_ENTRY_TYPE_LABEL[t]}
              </option>
            ))}
          </AutoSelect>
        )}
        <AutoSelect name="cur" defaultValue={sp.cur ?? ""} aria-label="Currency" className="w-auto">
          <option value="">All currencies</option>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </AutoSelect>
        <noscript>
          <button type="submit" className="text-xs underline">
            Apply
          </button>
        </noscript>
      </form>
      {removedChip && (
        <FilterChip
          href={buildHref(path, sp, { removed: removed ? "0" : undefined, page: undefined, panel: undefined, id: undefined })}
          active={removed}
          pill
        >
          Show removed
        </FilterChip>
      )}
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- one line of All entries */

/**
 * One posting side as All entries shows it: the day, the type, the reference (opens the entry), who it is with,
 * the order, "debit → credit", the amount in the main currency and as recorded. A removed one is struck through;
 * a correction says what it reverses and why.
 */
export function entryCells(r: LedgerListRow, main: string, today: string, open: string) {
  const reversal = !!r.reversesId;
  const base = reversal ? -Number(r.creditBase) : Number(r.debitBase) || Number(r.debit);
  const struck = (n: ReactNode) => (r.removed ? <s className="text-muted">{n}</s> : n);
  const what = reversal
    ? `Reverses ${r.ref}${r.reason ? ` · ${r.reason}` : ""}`
    : r.counter
      ? `${r.side === "debit" ? r.accountLabel : r.counter.label} → ${r.side === "debit" ? r.counter.label : r.accountLabel}`
      : r.accountLabel;
  return {
    day: day(r.date, today),
    type: struck(<TypeBadge type={r.type} />),
    ref: (
      <Link
        href={open}
        scroll={false}
        className={cn(
          "-my-1 inline-block py-1 font-medium tabular text-primary hover:underline",
          r.removed && "line-through decoration-text-2",
        )}
      >
        {r.ref || `#${r.entryNo}`}
        {reversal && <span aria-label=" (correction)"> ↺</span>}
      </Link>
    ),
    with: r.with ? struck(r.with.name) : <span className="text-muted">—</span>,
    order: r.order ? (
      <Link href={`/orders/${r.order.id}`} className="tabular hover:text-primary">
        {r.order.refNo}
      </Link>
    ) : (
      <span className="text-muted">—</span>
    ),
    what: struck(what),
    base: struck(amount(base)),
    recorded: (
      <span className="text-xs text-text-2">
        {r.removed
          ? `removed ${r.removed.on ? day(r.removed.on, today) : ""}`.trim()
          : reversal && r.reason
            ? r.reason
            : asRecorded(r, main)}
      </span>
    ),
  };
}

/* ---------------------------------------------------------------- ageing */

const AGE_TONE: Record<string, string> = { d1_30: "text-warn", d31_60: "text-warn", d61_90: "text-bad", d90_plus: "text-bad" };

/** The five ageing tiles: not due, 1–30, 31–60, 61–90, 90+ days late (in the main currency), each with what is in it. */
export function AgeingTiles({
  buckets,
  currency,
  label = "Ageing",
}: {
  buckets: AgeingBucketView[] | { bucket: string; label: string; base: string; items?: AgeingBucketView["items"] }[];
  currency: string;
  label?: string;
}) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {buckets.map((b) => {
        const items = "items" in b && b.items ? b.items : [];
        const hint = items.length
          ? items
              .slice(0, 2)
              .map((i) => [i.refNo, i.label].filter(Boolean).join(" · "))
              .join(", ") + (items.length > 2 ? ` +${items.length - 2}` : "")
          : "";
        return (
          <div key={b.bucket} className="rounded-xl border border-line bg-surface p-3 sm:p-4">
            <p className="text-xs font-medium text-muted">{b.label}</p>
            <p className={cn("mt-1 truncate text-lg font-semibold tabular sm:text-xl", Number(b.base) > 0 && AGE_TONE[b.bucket])}>
              {money(b.base, currency)}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted" title={hint || undefined}>
              {hint || " "}
            </p>
          </div>
        );
      })}
    </section>
  );
}
