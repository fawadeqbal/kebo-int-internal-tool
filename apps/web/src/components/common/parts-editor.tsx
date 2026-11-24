"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Lock, Plus, X } from "lucide-react";
import { formatMinor, fromMinor, toMinor } from "@kebo/money";
import { Button, cn, Input, Select } from "@kebo/ui";
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
  /** Its name comes from elsewhere (the deposit and balance: from how they pay): shown, not typed; why, in words. */
  named?: string;
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
export const shareText = (minor: number, totalMinor: number) =>
  totalMinor > 0 ? String(Number(((minor * 100) / totalMinor).toFixed(2))) : "";
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

const EQUAL = [2, 3, 4, 5, 6];

/** A label that is seen on a phone (where each installment is a card) and only read out on a wide screen (where the header names the columns). */
function CellLabel({ htmlFor, wide, children }: { htmlFor: string; wide: boolean; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className={
        wide
          ? wide
            ? "mb-1 block text-xs font-medium text-text-2 @3xl:sr-only"
            : "mb-1 block text-xs font-medium text-text-2 @min-[38rem]:sr-only"
          : "mb-1 block text-xs font-medium text-text-2 @min-[38rem]:sr-only"
      }
    >
      {children}
    </label>
  );
}

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
  /** Money needs more room for its table than percentages alone (the quotation's and the offer's terms). */
  const wide = showAmount;
  const ruleOf = (v: string) => rules.find((r) => r.value === v);
  const set = (key: string, p: Partial<EditorPart>) => onChange((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const fid = (p: EditorPart, f: string) => `${idPrefix}-${p.key}-${f}`;
  const cols = showAmount
    ? "@3xl:grid-cols-[1.5rem_minmax(6rem,1fr)_5.5rem_9rem_12.5rem_8.5rem_2rem]"
    : "@min-[38rem]:grid-cols-[1.5rem_minmax(5.5rem,1fr)_5.5rem_12.5rem_8.5rem_2rem]";

  /** A preset fits when every installment with money on it keeps at least that much (a paid one: exactly its amount). */
  const fits = (p: PartPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    return parts.every(
      (x, i) =>
        x.paidMinor <= 0 ||
        (amounts[i] !== undefined && (x.locked ? Math.abs(amounts[i]! - minorOf(x.amount)) <= 1 : amounts[i]! >= x.paidMinor)),
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
          dueDays: x.dueDays !== undefined ? String(x.dueDays) : ruleOf(x.rule)?.days !== undefined ? String(ruleOf(x.rule)!.days) : "",
          invoice: was?.invoice ?? "",
          paidMinor: was?.paidMinor ?? 0,
          locked: false,
          note: was?.note ?? null,
        };
      }),
    );
  };
  /** n equal installments: those already settled stay, the rest of the total is shared out evenly (the last takes any cent over). */
  const splitEqual = (n: number) =>
    onChange((old) => {
      const kept = old.filter((p) => p.locked);
      const open = old.filter((p) => !p.locked);
      const k = Math.max(Math.min(n, max) - kept.length, 1);
      const free = Math.max(totalMinor - kept.reduce((t, p) => t + minorOf(p.amount), 0), 0);
      const each = Math.floor(free / k);
      // A new installment is named for its place and falls due no earlier than the one before it (review 24 Nov: the
      // third of "3 equal" had no name and was due "When we order", after "When they say ready").
      const lastRule = () => rules.find((r) => r.value === (open.at(-1) ?? kept.at(-1))?.rule) ?? rules[rules.length - 1]!;
      const made = Array.from({ length: k }, (_, i): EditorPart => {
        const minor = i === k - 1 ? free - each * (k - 1) : each;
        const base = open[i] ?? { ...freshPart(minor, totalMinor, lastRule()), label: `Installment ${kept.length + i + 1}` };
        const share = shareText(minor, totalMinor);
        return { ...base, amount: fromMinor(minor), share, label: relabel(base.label || `Installment ${kept.length + i + 1}`, share) };
      });
      return [...kept, ...made];
    });
  const choose = (v: string) => {
    if (v.startsWith("equal:")) splitEqual(Number(v.slice(6)));
    else {
      const p = presets.find((x) => x.label === v);
      if (p) apply(p);
    }
  };
  const head = "px-1 text-xs font-semibold tracking-wide text-muted uppercase";

  return (
    // A table when there is room for it (a container query: the window, not the screen); a card per installment when not.
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Select aria-label="Apply template" className="w-full sm:w-64" value="" onChange={(e) => choose(e.target.value)}>
          <option value="">Apply template…</option>
          {presets.map((p) => (
            <option key={p.label} value={p.label} disabled={!fits(p)}>
              {p.label}
            </option>
          ))}
          <optgroup label="Split equally">
            {EQUAL.filter((n) => n <= max).map((n) => (
              <option key={n} value={`equal:${n}`}>
                {n} equal installments
              </option>
            ))}
          </optgroup>
        </Select>
        {showAmount && <span className="text-md text-text-2">Type a percentage or an amount: the other is filled in.</span>}
      </div>
      <div className="flex flex-col">
        <div
          aria-hidden
          className={cn(
            wide ? "hidden gap-2 border-b border-line pb-2 @3xl:grid" : "hidden gap-2 border-b border-line pb-2 @min-[38rem]:grid",
            cols,
          )}
        >
          <span className={cn(head, "text-center")}>#</span>
          <span className={head}>Description</span>
          <span className={cn(head, "text-right")}>%</span>
          {showAmount && <span className={cn(head, "text-right")}>Amount</span>}
          <span className={head}>Due</span>
          <span className={head}>Date / days</span>
          <span />
        </div>
        <ol
          aria-label="The installments"
          className={
            wide
              ? wide
                ? "flex flex-col gap-2 @3xl:gap-0"
                : "flex flex-col gap-2 @min-[38rem]:gap-0"
              : "flex flex-col gap-2 @min-[38rem]:gap-0"
          }
        >
          {parts.map((p, n) => {
            const rule = ruleOf(p.rule);
            const bad = problems?.[n] ?? null;
            const words = hint?.(p) ?? null;
            return (
              <li
                key={p.key}
                className={cn(
                  wide
                    ? "rounded-lg border border-line p-3 @3xl:rounded-none @3xl:border-0 @3xl:border-b @3xl:px-0 @3xl:py-2"
                    : "rounded-lg border border-line p-3 @min-[38rem]:rounded-none @min-[38rem]:border-0 @min-[38rem]:border-b @min-[38rem]:px-0 @min-[38rem]:py-2",
                  p.locked ? "bg-surface-2/70" : "bg-surface",
                )}
              >
                <div role="group" aria-label={`Installment ${n + 1}`}>
                  <div
                    className={cn(
                      wide
                        ? "grid grid-cols-2 items-start gap-x-2 gap-y-2 @3xl:items-center"
                        : "grid grid-cols-2 items-start gap-x-2 gap-y-2 @min-[38rem]:items-center",
                      cols,
                    )}
                  >
                    <span
                      className={
                        wide
                          ? wide
                            ? "text-md font-semibold text-muted @max-3xl:col-span-2 @3xl:text-center"
                            : "text-md font-semibold text-muted @max-[38rem]:col-span-2 @min-[38rem]:text-center"
                          : "text-md font-semibold text-muted @max-[38rem]:col-span-2 @min-[38rem]:text-center"
                      }
                    >
                      <span className={wide ? (wide ? "@3xl:hidden" : "@min-[38rem]:hidden") : "@min-[38rem]:hidden"}>Installment </span>
                      {n + 1}
                    </span>
                    <div
                      className={
                        wide
                          ? wide
                            ? "col-span-2 @3xl:col-span-1"
                            : "col-span-2 @min-[38rem]:col-span-1"
                          : "col-span-2 @min-[38rem]:col-span-1"
                      }
                    >
                      <CellLabel wide={wide} htmlFor={fid(p, "label")}>
                        Description
                      </CellLabel>
                      <Input
                        id={fid(p, "label")}
                        value={p.label}
                        maxLength={80}
                        disabled={p.locked}
                        readOnly={!!p.named}
                        title={p.named}
                        className={p.named ? "bg-surface-2 text-text-2" : undefined}
                        aria-invalid={bad?.field === "label" || undefined}
                        onChange={(e) => set(p.key, { label: e.target.value })}
                      />
                    </div>
                    <div>
                      <CellLabel wide={wide} htmlFor={fid(p, "share")}>
                        Percentage
                      </CellLabel>
                      <div className="relative">
                        <Input
                          id={fid(p, "share")}
                          inputMode="decimal"
                          className="pr-7 text-right tabular"
                          value={p.share}
                          disabled={p.locked}
                          onChange={(e) => {
                            const share = e.target.value;
                            const v = num(share);
                            const amount = Number.isFinite(v)
                              ? fromMinor(Math.round((totalMinor * Math.min(Math.max(v, 0), 100)) / 100))
                              : p.amount;
                            // Shares that add up to 100% leave no cent over: the last installment not yet paid takes
                            // the rounding (review 24 Nov, O-41: 30 / 40 / 30 was refused for 0.01).
                            onChange((all) => {
                              const next = all.map((x) => (x.key === p.key ? { ...x, share, amount, label: relabel(p.label, Number.isFinite(v) ? String(v) : "") } : x));
                              const shares = next.reduce((t, x) => t + (Number.isFinite(num(x.share)) ? num(x.share) : NaN), 0);
                              const at = next.map((x) => x.locked).lastIndexOf(false);
                              const off = totalMinor - sumOf(next);
                              if (Math.abs(shares - 100) > 1e-9 || at < 0 || off === 0 || Math.abs(off) > next.length) return next;
                              return next.map((x, i) => (i === at ? { ...x, amount: fromMinor(minorOf(x.amount) + off) } : x));
                            });
                          }}
                        />
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
                          %
                        </span>
                      </div>
                    </div>
                    {showAmount && currency && (
                      <div>
                        <CellLabel wide={wide} htmlFor={fid(p, "amount")}>
                          Amount
                        </CellLabel>
                        <MoneyInput
                          id={fid(p, "amount")}
                          className="h-10 text-right"
                          currency={currency}
                          value={p.amount}
                          disabled={p.locked}
                          aria-invalid={bad?.field === "amount" || undefined}
                          onChange={(e) => {
                            const amount = e.target.value;
                            const share = shareText(minorOf(amount), totalMinor);
                            set(p.key, { amount, share, label: relabel(p.label, share) });
                          }}
                        />
                      </div>
                    )}
                    <div
                      className={
                        wide
                          ? wide
                            ? "col-span-2 @3xl:col-span-1"
                            : "col-span-2 @min-[38rem]:col-span-1"
                          : "col-span-2 @min-[38rem]:col-span-1"
                      }
                    >
                      <CellLabel wide={wide} htmlFor={fid(p, "rule")}>
                        Due
                      </CellLabel>
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
                    </div>
                    <div
                      className={
                        wide
                          ? wide
                            ? "col-span-2 @3xl:col-span-1"
                            : "col-span-2 @min-[38rem]:col-span-1"
                          : "col-span-2 @min-[38rem]:col-span-1"
                      }
                    >
                      {rule?.needs === "date" ? (
                        <>
                          <CellLabel wide={wide} htmlFor={fid(p, "dueOn")}>
                            Date
                          </CellLabel>
                          <Input
                            id={fid(p, "dueOn")}
                            type="date"
                            value={p.dueOn}
                            disabled={p.locked}
                            aria-invalid={bad?.field === "dueOn" || undefined}
                            onChange={(e) => set(p.key, { dueOn: e.target.value })}
                          />
                        </>
                      ) : rule?.needs === "days" ? (
                        <>
                          <CellLabel wide={wide} htmlFor={fid(p, "dueDays")}>
                            {rule.daysLabel ?? "Days after"}
                          </CellLabel>
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
                        </>
                      ) : (
                        <span
                          className={
                            wide
                              ? wide
                                ? "px-1 text-md text-muted @max-3xl:hidden"
                                : "px-1 text-md text-muted @max-[38rem]:hidden"
                              : "px-1 text-md text-muted @max-[38rem]:hidden"
                          }
                        >
                          —
                        </span>
                      )}
                    </div>
                    <span
                      className={
                        wide
                          ? wide
                            ? "@max-3xl:hidden @3xl:flex @3xl:justify-center"
                            : "@max-[38rem]:hidden @min-[38rem]:flex @min-[38rem]:justify-center"
                          : "@max-[38rem]:hidden @min-[38rem]:flex @min-[38rem]:justify-center"
                      }
                    >
                      {p.locked ? (
                        <Lock role="img" aria-label="Paid: locked" className="size-4 text-ok" />
                      ) : (
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
                      )}
                    </span>
                  </div>
                  {(bad || invoices || words || p.note) && (
                    <div
                      className={
                        wide
                          ? wide
                            ? "mt-2 flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:gap-3 @3xl:pl-8"
                            : "mt-2 flex flex-col gap-2 @min-[38rem]:flex-row @min-[38rem]:items-center @min-[38rem]:gap-3 @min-[38rem]:pl-8"
                          : "mt-2 flex flex-col gap-2 @min-[38rem]:flex-row @min-[38rem]:items-center @min-[38rem]:gap-3 @min-[38rem]:pl-8"
                      }
                    >
                      {bad && <span className="text-xs font-medium text-bad">{bad.text}</span>}
                      {invoices && !p.locked && (
                        <div
                          className={
                            wide
                              ? wide
                                ? "@3xl:flex @3xl:items-center @3xl:gap-2"
                                : "@min-[38rem]:flex @min-[38rem]:items-center @min-[38rem]:gap-2"
                              : "@min-[38rem]:flex @min-[38rem]:items-center @min-[38rem]:gap-2"
                          }
                        >
                          <label
                            htmlFor={fid(p, "invoice")}
                            className={
                              wide
                                ? wide
                                  ? "mb-1 block text-xs font-medium text-text-2 @3xl:mb-0 @3xl:whitespace-nowrap"
                                  : "mb-1 block text-xs font-medium text-text-2 @min-[38rem]:mb-0 @min-[38rem]:whitespace-nowrap"
                                : "mb-1 block text-xs font-medium text-text-2 @min-[38rem]:mb-0 @min-[38rem]:whitespace-nowrap"
                            }
                          >
                            Supplier invoice no.
                          </label>
                          <Input
                            id={fid(p, "invoice")}
                            className={wide ? (wide ? "@3xl:w-44" : "@min-[38rem]:w-44") : "@min-[38rem]:w-44"}
                            maxLength={60}
                            value={p.invoice}
                            onChange={(e) => set(p.key, { invoice: e.target.value })}
                          />
                        </div>
                      )}
                      {(words || p.note) && (
                        <p className="flex flex-col gap-0.5 text-xs">
                          {p.note && <span className={p.note.warn ? "font-medium text-warn" : "font-medium text-ok"}>{p.note.text}</span>}
                          {words && <span className="text-muted">{words}</span>}
                        </p>
                      )}
                    </div>
                  )}
                  {!p.locked && (
                    <div
                      className={
                        wide
                          ? wide
                            ? "mt-2 flex justify-end @3xl:hidden"
                            : "mt-2 flex justify-end @min-[38rem]:hidden"
                          : "mt-2 flex justify-end @min-[38rem]:hidden"
                      }
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onChange((all) => all.filter((x) => x.key !== p.key))}
                        disabled={parts.length === 1 || p.paidMinor > 0}
                        aria-label={`Remove installment ${n + 1}`}
                      >
                        <X aria-hidden /> Remove
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <Button
          size="sm"
          variant="ghost"
          className={
            wide
              ? wide
                ? "mt-2 w-fit text-primary hover:text-primary @3xl:ml-6"
                : "mt-2 w-fit text-primary hover:text-primary @min-[38rem]:ml-6"
              : "mt-2 w-fit text-primary hover:text-primary @min-[38rem]:ml-6"
          }
          // A new installment starts with what is left to allocate (review 24 Nov, O-41: it started empty).
          onClick={() => onChange((all) => [...all, freshPart(Math.max(0, totalMinor - sumOf(all)), totalMinor, rules[0]!)])}
          disabled={parts.length >= max}
        >
          <Plus aria-hidden /> Add installment
        </Button>
      </div>
    </div>
  );
}

/** The total under the installments: green when they add up; red with what is left or too much, and the last installment takes it. */
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
  /** After "Fully allocated": what 100% is ("CNY 186,000.00"). */
  note?: ReactNode;
}) {
  const sum = sumOf(parts);
  const diff = totalMinor - sum;
  const ok = diff === 0;
  const pct = totalMinor > 0 ? Number(((sum * 100) / totalMinor).toFixed(2)) : 0;
  // The last installment not yet paid takes the difference: what is left over, or what is too much (e2e 24 Nov:
  // over 100% had no one-click fix). Taking off only while something is left in it.
  const last = parts.map((p) => p.locked).lastIndexOf(false);
  const canSettle = last >= 0 && diff !== 0 && minorOf(parts[last]!.amount) + diff > 0;
  const settleOnLast = () =>
    onChange((all) => {
      const at = all.map((p) => p.locked).lastIndexOf(false);
      if (at < 0 || diff === 0 || minorOf(all[at]!.amount) + diff <= 0) return all;
      return all.map((p, i) => {
        if (i !== at) return p;
        const minor = minorOf(p.amount) + diff;
        const share = shareText(minor, totalMinor);
        return { ...p, amount: fromMinor(minor), share, label: relabel(p.label, share) };
      });
    });
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={cn("flex basis-full flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-text pt-2.5", ok ? "text-ok" : "text-bad")}
    >
      <span className="text-md font-semibold text-text">Total</span>
      <b className="text-md tabular">
        {pct}%{currency ? ` · ${say(sum, currency)}` : ""}
      </b>
      <b role="status" className="inline-flex items-center gap-1.5 text-md">
        <Icon aria-hidden className="size-4" />
        {ok ? "Fully allocated · 100%" : diff > 0 ? `${say(diff, currency)} not allocated` : `${say(-diff, currency)} over-allocated`}
        {ok && note ? <span className="font-normal text-text-2"> · {note}</span> : null}
      </b>
      {canSettle && (
        <Button size="xs" variant="ghost" className="text-primary underline underline-offset-2 hover:text-primary" onClick={settleOnLast}>
          {diff > 0 ? "Add to last installment" : "Take from last installment"}
        </Button>
      )}
    </div>
  );
}

/** What stops the installments from adding up, in a sentence (null: they do). */
export function sumProblem(parts: EditorPart[], totalMinor: number, currency?: string): string | null {
  const diff = totalMinor - sumOf(parts);
  if (diff === 0) return null;
  return `The installments must add up to ${say(totalMinor, currency)}: ${diff > 0 ? `${say(diff, currency)} not allocated` : `${say(-diff, currency)} over-allocated`}.`;
}
