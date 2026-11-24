"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  LEAD_FROM_LABEL,
  LEAD_FROMS,
  PART_RULE_DAYS,
  PART_RULE_LABEL,
  PART_RULES,
  PAYMENT_ROUTE_HINT,
  PAYMENT_ROUTE_LABEL,
  PAYMENT_ROUTES,
  partAmounts,
  percentText,
  WARRANTY_FROM_LABEL,
  WARRANTY_FROMS,
  type LeadFrom,
  type PaymentRoute,
  type TermPart,
  type TermsSide,
  type WarrantyFrom,
} from "@kebo/shared";
import { fromMinor } from "@kebo/money";
import { cn, Field, Input, Select } from "@kebo/ui";
import { PERCENT_TOTAL, PartsEditor, PartsSummary, sumOf, type EditorPart, type PartRule } from "@/components/common/parts-editor";

/**
 * The terms' fields that the factory offer's form and the quotation's share (design "RFQ Desk — terms that
 * travel"): a lead time as days from a moment, the payment as parts (a usual one in one tap, each part's share
 * and when it falls due, a bar that adds them up), the warranty as months from a moment, and a check of what
 * we promise against what the factory gives.
 */

const newKey = () => Math.random().toString(36).slice(2);
/** "2,881.80" → 2881.8; NaN when it is not a number. */
const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, "").trim()) : NaN);

/* ---------------------------------------------------------------- the payment's parts */

/** One part as the form holds it while it is typed. */
export interface PartRow {
  key: string;
  label: string;
  /** Its share of the total, as typed ("30"). */
  share: string;
  rule: string;
  /** Its days, for the rules that take them. */
  days: string;
  /** Its amount as typed, where the total is known (kept so typing is not rounded under the cursor; the share is what is saved). */
  amount?: string;
}

/** A usual payment to start from ("30% now · 70% before shipment"). */
export interface PartsPreset {
  label: string;
  parts: { name: string; share: number; rule: string; days?: number }[];
}

export const partRows = (parts: TermPart[]): PartRow[] =>
  parts.map((p) => ({
    key: newKey(),
    label: p.label,
    share: percentText(p.percent),
    rule: p.rule,
    days: p.days === null ? "" : String(p.days),
  }));

/** The parts as the API takes them: a rule that takes no days sends none. */
export const partsPayload = (rows: PartRow[], side: TermsSide) =>
  rows.map((r) => ({
    label: r.label.trim(),
    percent: r.share.trim(),
    rule: r.rule,
    ...(PART_RULE_DAYS[side][r.rule] !== undefined ? { days: r.days.trim() } : {}),
  }));

/** The shares added up (a share that is not a number counts 0). */
export const sharesOf = (rows: PartRow[]) =>
  Math.round(rows.reduce((t, r) => t + (Number.isFinite(num(r.share)) ? num(r.share) : 0), 0) * 100) / 100;

/** The rows as parts, for their words and the checks: the ones with a share. */
export const rowsAsParts = (rows: PartRow[]): TermPart[] =>
  rows.flatMap((r) => {
    const n = num(r.share);
    return Number.isFinite(n) && n > 0
      ? [{ label: r.label, percent: n, rule: r.rule, days: r.days.trim() ? Number(r.days) || 0 : null }]
      : [];
  });

/** What stops the parts from being saved, in a sentence (null: nothing). */
export function partsProblem(rows: PartRow[]): string | null {
  if (!rows.length) return "Add an installment.";
  if (rows.some((r) => !r.label.trim())) return "Name each installment.";
  if (rows.some((r) => !(num(r.share) > 0 && num(r.share) <= 100))) return "Give each installment a percentage above 0%.";
  const sum = sharesOf(rows);
  if (Math.abs(sum - 100) >= 0.005)
    return `The installments must add up to 100%: ${percentText(Math.abs(100 - sum))}% ${sum < 100 ? "not allocated" : "over-allocated"}.`;
  return null;
}

/**
 * The payment as installments, inside a bigger form: the one installments editor the order's plans use too
 * (components/common/parts-editor), counting in percentages here (100% is the total, money is not known yet),
 * with a bar that adds them up (and what 100% is, when it is known).
 */
export function PartsField({
  id,
  idPrefix,
  side,
  rows,
  onChange,
  presets,
  amounts,
  totalMinor,
  currency,
  error,
}: {
  /** The whole block's id (a save that is stopped scrolls to it). */
  id?: string;
  idPrefix: string;
  side: TermsSide;
  rows: PartRow[];
  onChange: (rows: PartRow[]) => void;
  presets: PartsPreset[];
  /** What 100% is, after the sum ("CNY 186,000.00", "A USD 30,125.00 · B USD 32,070.00"). */
  amounts?: string | null;
  /** The total, in minor units, when there is one: then each installment takes an amount too, as on the order. */
  totalMinor?: number | null;
  currency?: string;
  error?: string[] | string;
}) {
  const money = Boolean(currency && totalMinor && totalMinor > 0);
  const total = money ? totalMinor! : PERCENT_TOTAL;
  const rules: PartRule[] = PART_RULES[side].map((v) => {
    const days = PART_RULE_DAYS[side][v];
    return {
      value: v,
      label: PART_RULE_LABEL[side][v],
      ...(days !== undefined ? { needs: "days" as const, days, ...(v === "lc" ? { daysLabel: "Days (0 at sight)" } : {}) } : {}),
    };
  });
  // Amounts from the shares as the quotation shows them (the last takes the cent left: partAmounts).
  const fromShares = partAmounts(
    rows.map((r) => (Number.isFinite(num(r.share)) ? num(r.share) : 0)),
    total,
  );
  const parts: EditorPart[] = rows.map((r, i) => {
    const v = num(r.share);
    return {
      key: r.key,
      id: null,
      label: r.label,
      share: r.share,
      amount: money && r.amount !== undefined ? r.amount : Number.isFinite(v) ? fromMinor(fromShares[i]!) : "",
      rule: r.rule,
      dueOn: "",
      dueDays: r.days,
      invoice: "",
      paidMinor: 0,
      locked: false,
      note: null,
    };
  });
  const change = (next: EditorPart[] | ((old: EditorPart[]) => EditorPart[])) => {
    const made = typeof next === "function" ? next(parts) : next;
    const out: PartRow[] = made.map((p) => ({
      key: p.key,
      label: p.label,
      share: p.share,
      rule: p.rule,
      days: p.dueDays,
      ...(money ? { amount: p.amount } : {}),
    }));
    // Amounts that add up to the total save as shares that add up to 100%: the last takes the rounding.
    if (money && out.length > 1 && sumOf(made) === total) {
      const others = out.slice(0, -1).reduce((t, r) => t + (Number.isFinite(num(r.share)) ? num(r.share) : 0), 0);
      out[out.length - 1] = { ...out[out.length - 1]!, share: percentText(Math.round((100 - others) * 100) / 100) };
    }
    onChange(out);
  };
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div id={id} className="flex scroll-mt-24 flex-col gap-3 sm:col-span-2 md:col-span-full">
      <PartsEditor
        parts={parts}
        onChange={change}
        totalMinor={total}
        currency={money ? currency : undefined}
        rules={rules}
        presets={presets.map((p) => ({
          label: p.label,
          parts: p.parts.map((x) => ({ name: x.name, share: x.share, rule: x.rule, ...(x.days !== undefined ? { dueDays: x.days } : {}) })),
        }))}
        idPrefix={idPrefix}
        max={8}
      />
      <PartsSummary
        parts={parts}
        onChange={change}
        totalMinor={total}
        currency={money ? currency : undefined}
        note={money ? null : amounts}
      />
      {message && <p className="text-xs text-bad">{message}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- how the customer pays */

const ROUTES: { value: PaymentRoute | ""; label: string; sub: string }[] = [
  { value: "", label: "Not decided yet", sub: "Asked on the order" },
  ...PAYMENT_ROUTES.map((r) => ({ value: r, label: PAYMENT_ROUTE_LABEL[r], sub: PAYMENT_ROUTE_HINT[r] })),
];

/** "How they pay": the route, or not decided yet (chosen on the order). */
export function RouteChoice({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: PaymentRoute | "";
  onChange: (v: PaymentRoute | "") => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5 sm:col-span-2 md:col-span-full">
      <legend className="mb-1.5 text-md font-medium text-text">How they pay</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ROUTES.map((r) => (
          <label
            key={r.value || "none"}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-sm transition-colors",
              value === r.value ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30" : "border-line hover:border-line-strong",
            )}
          >
            <input
              type="radio"
              name={`${idPrefix}-route`}
              className="mt-0.5 accent-[var(--color-primary)]"
              checked={value === r.value}
              onChange={() => onChange(r.value)}
            />
            <span>
              <span className="block font-medium">{r.label}</span>
              <span className="block text-xs text-text-2">{r.sub}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ---------------------------------------------------------------- the lead time */

/** "Lead time": its days, and what they count from. */
export function LeadField({
  id,
  label = "Lead time",
  side,
  days,
  from,
  onDays,
  onFrom,
  error,
  hint,
  className,
}: {
  id: string;
  label?: ReactNode;
  side: TermsSide;
  days: string;
  from: LeadFrom;
  onDays: (v: string) => void;
  onFrom: (v: LeadFrom) => void;
  error?: string[] | string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Field label={label} htmlFor={id} optional error={error} hint={hint} className={className}>
      <LeadInputs id={id} side={side} days={days} from={from} onDays={onDays} onFrom={onFrom} />
    </Field>
  );
}

/** The two boxes of a lead time (in a field, or in a table's cell with its own label). */
export function LeadInputs({
  id,
  side,
  days,
  from,
  onDays,
  onFrom,
  daysLabel,
}: {
  id: string;
  side: TermsSide;
  days: string;
  from: LeadFrom;
  onDays: (v: string) => void;
  onFrom: (v: LeadFrom) => void;
  /** Its name when no field label points at it (a table's cell). */
  daysLabel?: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="relative w-24 shrink-0">
        <Input
          id={id}
          aria-label={daysLabel}
          type="number"
          min={0}
          max={3650}
          inputMode="numeric"
          className="pr-11 tabular"
          value={days}
          placeholder="—"
          onChange={(e) => onDays(e.target.value)}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
          days
        </span>
      </span>
      <Select
        aria-label={daysLabel ? `${daysLabel}: what the days count from` : "What the days count from"}
        value={from}
        onChange={(e) => onFrom(e.target.value as LeadFrom)}
        className="min-w-0 flex-1"
      >
        {LEAD_FROMS.map((f) => (
          <option key={f} value={f}>
            {LEAD_FROM_LABEL[side][f]}
          </option>
        ))}
      </Select>
    </span>
  );
}

/* ---------------------------------------------------------------- the warranty */

/** Months, counted from, and what it covers: three fields of a section's grid. */
export function WarrantyFields({
  idPrefix,
  months,
  from,
  covers,
  onMonths,
  onFrom,
  onCovers,
  errors,
  coversHint,
}: {
  idPrefix: string;
  months: string;
  from: WarrantyFrom;
  covers: string;
  onMonths: (v: string) => void;
  onFrom: (v: WarrantyFrom) => void;
  onCovers: (v: string) => void;
  errors?: { months?: string[]; from?: string[]; covers?: string[] };
  coversHint?: ReactNode;
}) {
  return (
    <>
      <Field label="Months" htmlFor={`${idPrefix}-warranty-months`} optional error={errors?.months}>
        <Input
          id={`${idPrefix}-warranty-months`}
          type="number"
          min={0}
          max={240}
          inputMode="numeric"
          className="tabular"
          value={months}
          onChange={(e) => onMonths(e.target.value)}
        />
      </Field>
      <Field label="Counted from" htmlFor={`${idPrefix}-warranty-from`} error={errors?.from}>
        <Select id={`${idPrefix}-warranty-from`} value={from} onChange={(e) => onFrom(e.target.value as WarrantyFrom)}>
          {WARRANTY_FROMS.map((f) => (
            <option key={f} value={f}>
              {WARRANTY_FROM_LABEL[f]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="What it covers"
        htmlFor={`${idPrefix}-warranty`}
        optional
        error={errors?.covers}
        hint={coversHint}
        className="sm:col-span-2 md:col-span-1"
      >
        <Input id={`${idPrefix}-warranty`} maxLength={300} value={covers} onChange={(e) => onCovers(e.target.value)} />
      </Field>
    </>
  );
}

/* ---------------------------------------------------------------- against the factory */

/** A check of what we promise against what the factory gives: green when fine, amber with what to do. */
export function CheckNote({ ok, children, className }: { ok: boolean; children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 rounded-md px-3 py-2 text-xs text-text", ok ? "bg-ok-soft" : "bg-warn-soft", className)}>
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

/** A whole number typed in a box, for the API: "" stays empty (none), else the number. */
export const wholeOrNull = (v: string) => (v.trim() === "" ? null : v.trim());
/** A whole number typed in a box, for the checks: null when empty or not a number. */
export const wholeOf = (v: string) => {
  const n = num(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
