"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Plus, X } from "lucide-react";
import {
  LEAD_FROM_LABEL,
  LEAD_FROMS,
  PART_RULE_DAYS,
  PART_RULE_LABEL,
  PART_RULES,
  percentText,
  WARRANTY_FROM_LABEL,
  WARRANTY_FROMS,
  type LeadFrom,
  type PaymentRoute,
  type TermPart,
  type TermsSide,
  type WarrantyFrom,
} from "@kebo/shared";
import { Button, cn, Field, Input, Select } from "@kebo/ui";

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
  if (!rows.length) return "Add a part.";
  if (rows.some((r) => !r.label.trim())) return "Give each part a name.";
  if (rows.some((r) => !(num(r.share) > 0 && num(r.share) <= 100))) return "Give each part a share above 0%.";
  const sum = sharesOf(rows);
  if (Math.abs(sum - 100) >= 0.005)
    return `The parts must add up to 100%: ${sum < 100 ? `${percentText(100 - sum)}% short` : `${percentText(sum - 100)}% over`}.`;
  return null;
}

const presetRows = (p: PartsPreset, side: TermsSide): PartRow[] =>
  p.parts.map((x) => {
    const usual = PART_RULE_DAYS[side][x.rule];
    return {
      key: newKey(),
      label: x.share < 100 ? `${x.name} ${x.share}%` : x.name,
      share: String(x.share),
      rule: x.rule,
      days: x.days !== undefined ? String(x.days) : usual !== undefined ? String(usual) : "",
    };
  });
const isPreset = (rows: PartRow[], p: PartsPreset) =>
  rows.length === p.parts.length &&
  p.parts.every(
    (x, i) => rows[i]!.rule === x.rule && num(rows[i]!.share) === x.share && (x.days === undefined || num(rows[i]!.days) === x.days),
  );

/** "Deposit 30%" follows its share; a name of its own stays as typed. */
const relabel = (label: string, share: string) => {
  const m = /^(.*\S)\s+\d+(?:\.\d+)?%$/.exec(label);
  return m && share ? `${m[1]} ${share}%` : label;
};

const CHIP =
  "inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

/**
 * The payment as parts, inside a bigger form: a usual payment to start from, each part on its own line (what
 * it is, its share, when it falls due, its days where the rule takes them), "Add a part", and a bar that adds
 * the shares up as they are typed (with what 100% is, when it is known).
 */
export function PartsField({
  id,
  idPrefix,
  side,
  rows,
  onChange,
  presets,
  amounts,
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
  error?: string[] | string;
}) {
  const set = (key: string, patch: Partial<PartRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const sum = sharesOf(rows);
  const ok = Math.abs(sum - 100) < 0.005;
  const fid = (r: PartRow, f: string) => `${idPrefix}-${r.key}-${f}`;
  const message = Array.isArray(error) ? error[0] : error;
  const add = () => {
    const left = Math.round((100 - sum) * 100) / 100;
    const rule = side === "customer" ? "before_shipment" : "on_ready";
    onChange([...rows, { key: newKey(), label: "", share: left > 0 ? percentText(left) : "", rule, days: "" }]);
  };
  return (
    <div id={id} className="flex scroll-mt-24 flex-col gap-3 sm:col-span-2 md:col-span-full">
      {presets.length > 0 && (
        <div role="group" aria-label="Start from a usual payment" className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-text-2">Start from</span>
          {presets.map((p) => {
            const on = isPreset(rows, p);
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(presetRows(p, side))}
                className={cn(
                  CHIP,
                  on ? "border-primary bg-primary-soft text-primary" : "border-line-strong bg-surface text-text hover:bg-surface-2",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      <ol className="flex flex-col gap-2" aria-label="The parts">
        {rows.map((r, n) => {
          const takesDays = PART_RULE_DAYS[side][r.rule] !== undefined;
          const remove = (className?: string) => (
            <Button
              size="icon-xs"
              variant="ghost"
              className={className}
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              disabled={rows.length === 1}
              aria-label={`Remove part ${n + 1}`}
            >
              <X aria-hidden />
            </Button>
          );
          return (
            <li key={r.key} className="rounded-lg border border-line bg-surface p-2.5">
              {/* A phone: the part's number and its remove on top; the share beside when it falls due. */}
              <div className="mb-1.5 flex items-center justify-between md:hidden">
                <span className="text-[13px] font-semibold">Part {n + 1}</span>
                {remove()}
              </div>
              <div
                role="group"
                aria-label={`Part ${n + 1}`}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 md:grid-cols-[1.5rem_minmax(0,1.3fr)_5.5rem_minmax(0,1.4fr)_6.5rem_2rem] md:items-end"
              >
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-full bg-text text-xs font-bold text-surface max-md:hidden md:mb-2"
                >
                  {n + 1}
                </span>
                <Field label="What it is" htmlFor={fid(r, "label")} className="col-span-2 md:col-span-1">
                  <Input
                    id={fid(r, "label")}
                    value={r.label}
                    maxLength={80}
                    onChange={(e) => set(r.key, { label: e.target.value })}
                  />
                </Field>
                <Field label="Share" htmlFor={fid(r, "share")}>
                  <div className="relative">
                    <Input
                      id={fid(r, "share")}
                      inputMode="decimal"
                      className="pr-7 tabular"
                      value={r.share}
                      onChange={(e) => {
                        const share = e.target.value;
                        const v = num(share);
                        set(r.key, { share, label: relabel(r.label, Number.isFinite(v) ? String(v) : "") });
                      }}
                    />
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
                      %
                    </span>
                  </div>
                </Field>
                <Field label="When" htmlFor={fid(r, "rule")}>
                  <Select
                    id={fid(r, "rule")}
                    value={r.rule}
                    onChange={(e) => {
                      const rule = e.target.value;
                      const usual = PART_RULE_DAYS[side][rule];
                      set(r.key, { rule, days: usual === undefined ? "" : r.days || String(usual) });
                    }}
                  >
                    {PART_RULES[side].map((v) => (
                      <option key={v} value={v}>
                        {PART_RULE_LABEL[side][v]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {takesDays ? (
                  <Field label={r.rule === "lc" ? "Days (0 at sight)" : "Days after"} htmlFor={fid(r, "days")}>
                    <Input
                      id={fid(r, "days")}
                      type="number"
                      min={0}
                      max={3650}
                      className="tabular"
                      value={r.days}
                      onChange={(e) => set(r.key, { days: e.target.value })}
                    />
                  </Field>
                ) : (
                  <span aria-hidden className="max-md:hidden" />
                )}
                <span className="max-md:hidden md:mb-2 md:justify-self-end">{remove()}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <Button size="sm" variant="ghost" className="w-fit" onClick={add} disabled={rows.length >= 8}>
        <Plus aria-hidden /> Add a part
      </Button>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2", ok ? "bg-ok-soft" : "bg-bad-soft")}>
        <b role="status" className={cn("text-[13px] tabular sm:whitespace-nowrap", ok ? "text-ok" : "text-bad")}>
          {ok
            ? `Adds up: 100%${amounts ? ` · ${amounts}` : ""}`
            : sum < 100
              ? `${percentText(100 - sum)}% short · ${percentText(sum)}%`
              : `${percentText(sum - 100)}% over · ${percentText(sum)}%`}
        </b>
        <span aria-hidden className="flex h-2 min-w-24 flex-1 basis-full overflow-hidden rounded-full bg-text/10 sm:basis-auto">
          {rows.map((r, i) => {
            const v = num(r.share);
            return (
              <i
                key={r.key}
                className={cn("block h-full", (ok ? ["bg-ok", "bg-ok/55"] : ["bg-bad", "bg-bad/55"])[i % 2])}
                style={{ width: `${Number.isFinite(v) ? Math.max(Math.min((v * 100) / Math.max(sum, 100), 100), 0) : 0}%` }}
              />
            );
          })}
        </span>
      </div>
      {message && <p className="text-xs text-bad">{message}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- how the customer pays */

const ROUTES: { value: PaymentRoute | ""; label: string; sub: string }[] = [
  { value: "", label: "Not decided yet", sub: "asked on the order" },
  { value: "informal", label: "Informal", sub: "T/T, cash, Alipay, WeChat" },
  { value: "bank_contract", label: "Bank contract", sub: "through the banks" },
  { value: "letter_of_credit", label: "Letter of credit", sub: "LC at sight or after days" },
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
      <legend className="mb-1.5 text-[13px] font-medium text-text">How they pay</legend>
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
        <Input
          id={`${idPrefix}-warranty`}
          maxLength={300}
          value={covers}
          onChange={(e) => onCovers(e.target.value)}
        />
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
