"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { formatMinor, fromMinor, toMinor } from "@kebo/money";
import { Button, cn, Field, Input, Select } from "@kebo/ui";
import { MoneyInput } from "@/components/common/money-input";

/**
 * The one editor for a payment split into installments — a customer's plan, a supplier's plan, a quotation's
 * payment terms and a supplier offer's: every installment on its own line (what it is, its percentage and its
 * amount, when it falls due and its date or days), "Set by" amount, percentage or equal installments, a usual
 * split to start from, and a bar that adds them up. Where the total is not money yet (a quotation's terms) it
 * works in percentages: the total is 100% and the amount column is not shown.
 */

/** When an installment falls due, and whether it takes a date or a number of days of its own. */
export interface PartRule {
  value: string;
  label: string;
  needs?: "date" | "days";
  /** The days a "days after" rule starts with. */
  days?: number;
  /** The field's name where it is not "Days after" ("Days (0 at sight)"). */
  daysLabel?: string;
}

/** One installment, as the editor holds it while it is changed. */
export interface EditorPart {
  key: string;
  /** Its stored row (null: a new installment). */
  id: string | null;
  label: string;
  /** Its percentage of the total, as typed ("30"). */
  share: string;
  amount: string;
  rule: string;
  dueOn: string;
  dueDays: string;
  /** Their invoice no. (a supplier's plan). */
  invoice: string;
  /** Paid on it so far, in minor units: it cannot go below that. */
  paidMinor: number;
  /** Paid in full: shown as it is, not changed. */
  locked: boolean;
  /** A word under the installment: paid, sent. */
  note: { text: string; warn?: boolean } | null;
}

/** A usual split to start from ("30% on confirmation · 70% before shipment"). */
export interface PartPreset {
  label: string;
  parts: { name: string; share: number; rule: string; dueOn?: string; dueDays?: number }[];
}

export interface PartProblem {
  field: "label" | "amount" | "dueOn";
  text: string;
}

/** A percentage-only editor counts the total as 100.00: an amount in minor units is the percentage ×100. */
export const PERCENT_TOTAL = 10000;

export const newKey = () => Math.random().toString(36).slice(2);
/** "2,881.80" → 2881.8; NaN when it is not a number. */
export const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, "").trim()) : NaN);
export const minorOf = (v: string) => {
  const n = num(v);
  return Number.isFinite(n) ? toMinor(n.toFixed(2)) : 0;
};
/** 30, 33.33: a share as it is shown. */
export const shareText = (minor: number, totalMinor: number) => (totalMinor > 0 ? String(Number(((minor * 100) / totalMinor).toFixed(2))) : "");
/** "Deposit 30%" follows its share; "Balance before shipment" keeps its name. */
export const relabel = (label: string, share: string) => {
  const m = /^(.*\S)\s+\d+(?:\.\d+)?%$/.exec(label);
  return m && share ? `${m[1]} ${share}%` : label;
};
/** A sum as it is said: money in a plan, a percentage in terms. */
const say = (minor: number, currency?: string) => (currency ? formatMinor(minor, currency) : `${Number((minor / 100).toFixed(2))}%`);

/** A new, open installment holding `amount` (minor units), due by the first rule. */
export function freshPart(amountMinor: number, totalMinor: number, rule: PartRule): EditorPart {
  return {
    key: newKey(),
    id: null,
    label: "",
    share: amountMinor > 0 ? shareText(amountMinor, totalMinor) : "",
    amount: amountMinor > 0 ? fromMinor(amountMinor) : "",
    rule: rule.value,
    dueOn: "",
    dueDays: rule.days !== undefined ? String(rule.days) : "",
    invoice: "",
    paidMinor: 0,
    locked: false,
    note: null,
  };
}

/** What stops an installment from being saved, and the field to fix (null: nothing). */
export function partProblem(p: EditorPart, rules: PartRule[], currency?: string): PartProblem | null {
  if (p.locked) return null;
  const minor = minorOf(p.amount);
  if (!p.label.trim()) return { field: "label", text: "Name the installment" };
  if (minor <= 0) return { field: "amount", text: "More than 0" };
  if (minor < p.paidMinor)
    return { field: "amount", text: `At least ${formatMinor(p.paidMinor, currency ?? "USD")}: that amount is already applied` };
  if (rules.find((r) => r.value === p.rule)?.needs === "date" && !p.dueOn) return { field: "dueOn", text: "Choose its date" };
  return null;
}

/** The parts' amounts added up. */
export const sumOf = (parts: EditorPart[]) => parts.reduce((t, p) => t + minorOf(p.amount), 0);

/** A preset's amounts: each its share of the total, the last one the rest, so they add up exactly. */
function presetAmounts(p: PartPreset, totalMinor: number) {
  let left = totalMinor;
  return p.parts.map((x, i) => {
    const minor = i === p.parts.length - 1 ? left : Math.round((totalMinor * x.share) / 100);
    left -= minor;
    return minor;
  });
}

/** How the amounts are typed: each as an amount, each as a percentage, or split into equal installments. */
type Basis = "amount" | "percent" | "equal";
const BASES: { value: Basis; label: string }[] = [
  { value: "amount", label: "Amount" },
  { value: "percent", label: "Percentage" },
  { value: "equal", label: "Equal installments" },
];

const CHIP =
  "inline-flex min-h-8 items-center rounded-full border px-3 text-md font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function PartsEditor({
  parts,
  onChange,
  totalMinor,
  currency,
  rules,
  presets,
  idPrefix,
  invoices,
  hint,
  problems,
  max = 12,
}: {
  parts: EditorPart[];
  onChange: (next: EditorPart[] | ((old: EditorPart[]) => EditorPart[])) => void;
  /** The total, in minor units; in a percentage-only editor PERCENT_TOTAL. */
  totalMinor: number;
  /** Money: shows the amounts. Left out, the editor counts in percentages only. */
  currency?: string;
  rules: PartRule[];
  presets: PartPreset[];
  idPrefix: string;
  /** A supplier's plan: their invoice no. on each installment. */
  invoices?: boolean;
  /** Under an installment: what its rule means for its date. */
  hint?: (p: EditorPart) => string | null;
  /** What to show against each installment (a save that was tried). */
  problems?: (PartProblem | null)[];
  max?: number;
}) {
  const showAmount = Boolean(currency);
  const [basis, setBasis] = useBasis(showAmount);
  const [count, setCount] = useCount(parts.length);
  const ruleOf = (v: string) => rules.find((r) => r.value === v);
  const set = (key: string, p: Partial<EditorPart>) => onChange((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const sum = sumOf(parts);
  const diff = totalMinor - sum;
  const fid = (p: EditorPart, f: string) => `${idPrefix}-${p.key}-${f}`;
  const bases = BASES.filter((b) => showAmount || b.value !== "amount");

  /** A preset fits when every installment with money on it keeps at least that much (a paid one: exactly its amount). */
  const fits = (p: PartPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    return parts.every(
      (x, i) =>
        x.paidMinor <= 0 ||
        (amounts[i] !== undefined && (x.locked ? Math.abs(amounts[i]! - minorOf(x.amount)) <= 1 : amounts[i]! >= x.paidMinor)),
    );
  };
  const chosen = (p: PartPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    return (
      parts.length === p.parts.length &&
      p.parts.every((x, i) => parts[i]!.rule === x.rule && Math.abs(minorOf(parts[i]!.amount) - amounts[i]!) <= 1)
    );
  };
  const apply = (p: PartPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    onChange((old) =>
      p.parts.map((x, i): EditorPart => {
        const was = old[i];
        if (was?.locked) return was;
        return {
          key: was?.key ?? newKey(),
          id: was?.id ?? null,
          label: x.share < 100 ? `${x.name} ${x.share}%` : x.name,
          share: String(x.share),
          amount: fromMinor(amounts[i]!),
          rule: x.rule,
          dueOn: x.dueOn ?? (was?.rule === x.rule ? was.dueOn : ""),
          dueDays: x.dueDays !== undefined ? String(x.dueDays) : (ruleOf(x.rule)?.days !== undefined ? String(ruleOf(x.rule)!.days) : ""),
          invoice: was?.invoice ?? "",
          paidMinor: was?.paidMinor ?? 0,
          locked: false,
          note: was?.note ?? null,
        };
      }),
    );
  };
  /** A new installment: empty, or holding the balance that no installment holds yet. */
  const add = (withBalance: boolean) => onChange((all) => [...all, freshPart(withBalance && diff > 0 ? diff : 0, totalMinor, rules[0]!)]);
  /** n equal installments: those already settled stay, the rest of the total is shared out evenly (the last takes any cent over). */
  const splitEqual = (n: number) => {
    const size = Math.min(Math.max(Math.round(n) || 2, 1), max);
    setCount(size);
    onChange((old) => {
      const kept = old.filter((p) => p.locked);
      const open = old.filter((p) => !p.locked);
      const k = Math.max(size - kept.length, 1);
      const free = Math.max(totalMinor - kept.reduce((t, p) => t + minorOf(p.amount), 0), 0);
      const each = Math.floor(free / k);
      const made = Array.from({ length: k }, (_, i): EditorPart => {
        const minor = i === k - 1 ? free - each * (k - 1) : each;
        const was = open[i];
        const base = was ?? freshPart(minor, totalMinor, rules[0]!);
        const share = shareText(minor, totalMinor);
        return { ...base, amount: fromMinor(minor), share, label: relabel(base.label, share) };
      });
      return [...kept, ...made];
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Basis of the installments" className="flex flex-wrap items-center gap-2">
        <span className="text-md text-text-2">Set by</span>
        {bases.map((b) => (
          <button
            key={b.value}
            type="button"
            aria-pressed={basis === b.value}
            onClick={() => {
              setBasis(b.value);
              if (b.value === "equal") splitEqual(count);
            }}
            className={cn(CHIP, basis === b.value ? "border-primary bg-primary-soft text-primary" : "border-line-strong bg-surface text-text hover:bg-surface-2")}
          >
            {b.label}
          </button>
        ))}
        {basis === "equal" && (
          <span className="ml-1 inline-flex items-center gap-2 text-md text-text-2">
            <Button size="icon-xs" variant="ghost" aria-label="Fewer installments" onClick={() => splitEqual(count - 1)} disabled={count <= 1}>
              −
            </Button>
            <b className="w-5 text-center font-semibold text-text tabular">{count}</b>
            <Button size="icon-xs" variant="ghost" aria-label="More installments" onClick={() => splitEqual(count + 1)} disabled={count >= max}>
              +
            </Button>
            installments
          </span>
        )}
      </div>
      {presets.length > 0 && (
        <div role="group" aria-label="Start from a template" className="flex flex-wrap items-center gap-2">
          <span className="text-md text-text-2">Start from template</span>
          {presets.map((p) => {
            const on = chosen(p);
            const can = fits(p);
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                disabled={!can}
                title={can ? undefined : "A settled installment would change: change the installments one by one"}
                onClick={() => apply(p)}
                className={cn(CHIP, on ? "border-primary bg-primary-soft text-primary" : "border-line-strong bg-surface text-text hover:bg-surface-2")}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      <ol className="flex flex-col gap-3" aria-label="The installments">
        {parts.map((p, n) => {
          const rule = ruleOf(p.rule);
          const bad = problems?.[n] ?? null;
          const words = hint?.(p) ?? null;
          const remove = (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => onChange((all) => all.filter((x) => x.key !== p.key))}
              disabled={parts.length === 1 || p.paidMinor > 0}
              title={p.paidMinor > 0 ? "A payment is applied to it: it stays" : undefined}
              aria-label={`Remove installment ${n + 1}`}
            >
              <X aria-hidden />
            </Button>
          );
          const percentField = (
            <Field label="Percentage" htmlFor={fid(p, "share")}>
              <div className="relative">
                <Input
                  id={fid(p, "share")}
                  inputMode="decimal"
                  className={cn("pr-7 tabular", showAmount && basis !== "percent" && !p.locked && "bg-surface-2 text-text-2")}
                  value={p.share}
                  disabled={p.locked}
                  readOnly={showAmount && basis !== "percent"}
                  onChange={(e) => {
                    const share = e.target.value;
                    const v = num(share);
                    const amount = Number.isFinite(v) ? fromMinor(Math.round((totalMinor * Math.min(Math.max(v, 0), 100)) / 100)) : p.amount;
                    set(p.key, { share, amount, label: relabel(p.label, Number.isFinite(v) ? String(v) : "") });
                  }}
                />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
                  %
                </span>
              </div>
            </Field>
          );
          return (
            <li key={p.key} className={cn("rounded-lg border border-line p-3", p.locked ? "bg-surface-2/60" : "bg-surface")}>
              <div role="group" aria-label={`Installment ${n + 1}`}>
                <div className="mb-2 flex items-center justify-between md:hidden">
                  <span className="text-md font-semibold">Installment {n + 1}</span>
                  {remove}
                </div>
                <div
                  className={cn(
                    "grid grid-cols-2 gap-x-3 gap-y-2.5 md:items-end",
                    showAmount
                      ? "md:grid-cols-[1.75rem_minmax(0,1.2fr)_5rem_8rem_minmax(0,1.4fr)_8rem_2rem]"
                      : "md:grid-cols-[1.75rem_minmax(0,1.3fr)_6rem_minmax(0,1.4fr)_8rem_2rem]",
                  )}
                >
                  <span aria-hidden className="grid size-7 place-items-center rounded-full bg-text text-xs font-bold text-surface max-md:hidden md:mb-1">
                    {n + 1}
                  </span>
                  <Field
                    label="Installment"
                    htmlFor={fid(p, "label")}
                    error={bad?.field === "label" ? bad.text : undefined}
                    className="col-span-2 md:col-span-1"
                  >
                    <Input id={fid(p, "label")} value={p.label} maxLength={80} disabled={p.locked} onChange={(e) => set(p.key, { label: e.target.value })} />
                  </Field>
                  {percentField}
                  {showAmount && currency && (
                    <Field label="Amount" htmlFor={fid(p, "amount")} error={bad?.field === "amount" ? bad.text : undefined}>
                      <MoneyInput
                        id={fid(p, "amount")}
                        className={cn("h-10", basis === "percent" && !p.locked && "bg-surface-2 text-text-2")}
                        currency={currency}
                        value={p.amount}
                        disabled={p.locked}
                        readOnly={basis === "percent"}
                        onChange={(e) => {
                          const amount = e.target.value;
                          const share = shareText(minorOf(amount), totalMinor);
                          set(p.key, { amount, share, label: relabel(p.label, share) });
                        }}
                      />
                    </Field>
                  )}
                  <Field label="Due" htmlFor={fid(p, "rule")} className="col-span-2 md:col-span-1">
                    <Select
                      id={fid(p, "rule")}
                      value={p.rule}
                      disabled={p.locked}
                      onChange={(e) => {
                        const next = ruleOf(e.target.value);
                        set(p.key, {
                          rule: e.target.value,
                          ...(next?.needs === "days" && !p.dueDays ? { dueDays: String(next.days ?? 0) } : {}),
                          ...(next?.needs !== "days" ? { dueDays: "" } : {}),
                        });
                      }}
                    >
                      {rules.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {rule?.needs === "date" ? (
                    <Field label="Date" htmlFor={fid(p, "dueOn")} error={bad?.field === "dueOn" ? bad.text : undefined} className="col-span-2 md:col-span-1">
                      <Input id={fid(p, "dueOn")} type="date" value={p.dueOn} disabled={p.locked} onChange={(e) => set(p.key, { dueOn: e.target.value })} />
                    </Field>
                  ) : rule?.needs === "days" ? (
                    <Field label={rule.daysLabel ?? "Days after"} htmlFor={fid(p, "dueDays")} className="col-span-2 md:col-span-1">
                      <Input
                        id={fid(p, "dueDays")}
                        type="number"
                        min={0}
                        max={3650}
                        className="tabular"
                        value={p.dueDays}
                        disabled={p.locked}
                        onChange={(e) => set(p.key, { dueDays: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <span className="max-md:hidden md:mb-2.5 md:text-md md:text-muted">Dated by its rule</span>
                  )}
                  <span className="max-md:hidden md:mb-0.5">{remove}</span>
                </div>
                {(invoices || words || p.note) && (
                  <div className="mt-2.5 flex flex-col gap-2 md:flex-row md:items-end md:gap-3 md:pl-[2.5rem]">
                    {invoices && (
                      <Field label="Supplier invoice no." htmlFor={fid(p, "invoice")} optional className="md:w-56 md:shrink-0">
                        <Input id={fid(p, "invoice")} maxLength={60} value={p.invoice} onChange={(e) => set(p.key, { invoice: e.target.value })} />
                      </Field>
                    )}
                    {(words || p.note) && (
                      <p className="flex flex-col gap-0.5 text-xs md:mb-2.5">
                        {p.note && <span className={p.note.warn ? "font-medium text-warn" : "text-text-2"}>{p.note.text}</span>}
                        {words && <span className="text-muted">{words}</span>}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" className="w-fit" onClick={() => add(false)} disabled={parts.length >= max}>
          <Plus aria-hidden /> Add installment
        </Button>
        {diff > 0 && (
          <Button size="sm" variant="ghost" className="w-fit" onClick={() => add(true)} disabled={parts.length >= max}>
            <Plus aria-hidden /> Add balance as new installment
          </Button>
        )}
      </div>
    </div>
  );
}

/** The bar that says how much of the total the installments hold, with "Add to final installment" for what is left. */
export function PartsSummary({
  parts,
  onChange,
  totalMinor,
  currency,
  note,
}: {
  parts: EditorPart[];
  onChange: (next: EditorPart[] | ((old: EditorPart[]) => EditorPart[])) => void;
  totalMinor: number;
  currency?: string;
  /** After "Fully allocated · 100%": what 100% is ("CNY 186,000.00"). */
  note?: ReactNode;
}) {
  const sum = sumOf(parts);
  const diff = totalMinor - sum;
  const ok = diff === 0;
  const pct = totalMinor > 0 ? Number(((sum * 100) / totalMinor).toFixed(2)) : 0;
  const tones = ok ? ["bg-ok", "bg-ok/55"] : ["bg-bad", "bg-bad/55"];
  /** The balance goes onto the last open installment. */
  const addToLast = () =>
    onChange((all) => {
      const at = all.map((p) => p.locked).lastIndexOf(false);
      if (at < 0 || diff <= 0) return all;
      return all.map((p, i) => {
        if (i !== at) return p;
        const minor = minorOf(p.amount) + diff;
        const share = shareText(minor, totalMinor);
        return { ...p, amount: fromMinor(minor), share, label: relabel(p.label, share) };
      });
    });
  return (
    <div className={cn("flex basis-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2", ok ? "bg-ok-soft" : "bg-bad-soft")}>
      <b role="status" className={cn("text-md tabular sm:whitespace-nowrap", ok ? "text-ok" : "text-bad")}>
        {ok
          ? `Fully allocated · 100%${currency ? ` · ${say(totalMinor, currency)}` : ""}`
          : diff > 0
            ? `${say(diff, currency)} not allocated · ${pct}%`
            : `${say(-diff, currency)} over-allocated · ${pct}%`}
        {ok && note ? <span className="font-normal"> · {note}</span> : null}
      </b>
      {diff > 0 && parts.some((p) => !p.locked) && (
        <Button size="xs" variant="ghost" className="text-primary hover:text-primary" onClick={addToLast}>
          Add to final installment
        </Button>
      )}
      <span aria-hidden className="flex h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-black/10">
        {parts.map((p, i) => (
          <i
            key={p.key}
            className={cn("block h-full", tones[i % 2])}
            style={{ width: `${totalMinor > 0 ? Math.max(Math.min((minorOf(p.amount) * 100) / Math.max(totalMinor, sum), 100), 0) : 0}%` }}
          />
        ))}
      </span>
    </div>
  );
}

/** What stops the installments from adding up, in a sentence (null: they do). */
export function sumProblem(parts: EditorPart[], totalMinor: number, currency?: string): string | null {
  const diff = totalMinor - sumOf(parts);
  if (diff === 0) return null;
  return `The installments must add up to ${say(totalMinor, currency)}: ${diff > 0 ? `${say(diff, currency)} not allocated` : `${say(-diff, currency)} over-allocated`}.`;
}

/** The editor's own state: how the amounts are typed, and how many equal installments. */
function useBasis(showAmount: boolean) {
  return useState<Basis>(showAmount ? "amount" : "percent");
}
function useCount(n: number) {
  return useState(() => Math.max(n, 2));
}
