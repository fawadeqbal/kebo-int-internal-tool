"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { formatMinor, fromMinor, toMinor } from "@kebo/money";
import { addDays } from "@kebo/utils";
import { Button, cn, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { MoneyInput } from "@/components/common/money-input";
import { PanelActions, PanelBody, SidePanel, useClosePanel } from "@/components/common/panel";
import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import type { ActionState } from "@/lib/actions";
import type { FactoryPlanView, OrderMoney } from "@/lib/types-money";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** When a part falls due, and whether it takes a date or a number of days of its own. */
export interface PlanRule {
  value: string;
  label: string;
  needs?: "date" | "days";
  /** The days a "days after" rule starts with. */
  days?: number;
}

/** One part of a plan, as the editor holds it while it is changed. */
export interface PlanPart {
  key: string;
  /** Its stored row (null: a new part). */
  id: string | null;
  label: string;
  /** Its share of the total, as typed ("30"). */
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
  /** A word under the part: paid, sent. */
  note: { text: string; warn?: boolean } | null;
}

/** A usual plan to start from ("30% now · 70% before shipment"). */
export interface PlanPreset {
  label: string;
  parts: { name: string; share: number; rule: string; dueOn?: string; dueDays?: number }[];
}

const newKey = () => Math.random().toString(36).slice(2);
/** "2,881.80" → 2881.8; NaN when it is not a number. */
const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, "").trim()) : NaN);
const minorOf = (v: string) => {
  const n = num(v);
  return Number.isFinite(n) ? toMinor(n.toFixed(2)) : 0;
};
/** 30, 33.33: a share as it is shown. */
const shareText = (minor: number, totalMinor: number) => (totalMinor > 0 ? String(Number(((minor * 100) / totalMinor).toFixed(2))) : "");
/** "Deposit 30%" follows its share; "Balance before shipment" keeps its name. */
const relabel = (label: string, share: string) => {
  const m = /^(.*\S)\s+\d+(?:\.\d+)?%$/.exec(label);
  return m && share ? `${m[1]} ${share}%` : label;
};

/** A preset's amounts: each its share of the total, the last one the rest, so they add up exactly. */
function presetAmounts(p: PlanPreset, totalMinor: number) {
  let left = totalMinor;
  return p.parts.map((x, i) => {
    const minor = i === p.parts.length - 1 ? left : Math.round((totalMinor * x.share) / 100);
    left -= minor;
    return minor;
  });
}

/**
 * The one plan editor (design "one plan editor, clearer"), for the customer's plan and each supplier's: each
 * part on its own line with names over its fields — what it is, its share as a % or an amount (the other
 * follows), when it falls due and its date or days when the rule needs them, their invoice no. on a
 * supplier's — a usual plan to start from, and a bar that adds the parts up as they are typed. A part paid in
 * full stays as it was paid; a part paid in part cannot go below what was paid. Save checks the sum first.
 */
export function PlanEditor({
  intro,
  totalMinor,
  currency,
  rules,
  presets,
  start,
  invoices,
  hint,
  action,
  toPayload,
  onDone,
}: {
  intro: ReactNode;
  totalMinor: number;
  currency: string;
  rules: PlanRule[];
  presets: PlanPreset[];
  start: PlanPart[];
  /** A supplier's plan: their invoice no. on each part. */
  invoices?: boolean;
  /** Under a part: what its rule means for its date ("Its date comes from the ready date (08/11)…"). */
  hint: (p: PlanPart) => string | null;
  action: Action;
  toPayload: (parts: PlanPart[]) => unknown;
  onDone: () => void;
}) {
  const base = useId();
  const close = useClosePanel();
  const [parts, setParts] = useState<PlanPart[]>(start);
  const [tried, setTried] = useState(false);
  const ruleOf = (v: string) => rules.find((r) => r.value === v);
  const set = (key: string, p: Partial<PlanPart>) => setParts((all) => all.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const sum = parts.reduce((t, p) => t + minorOf(p.amount), 0);
  const diff = totalMinor - sum;
  const fid = (p: PlanPart, f: string) => `${base}-${p.key}-${f}`;

  /** What stops a part from being saved, and the field to fix. */
  const problem = (p: PlanPart): { field: string; text: string } | null => {
    if (p.locked) return null;
    const minor = minorOf(p.amount);
    if (!p.label.trim()) return { field: "label", text: "Give it a name" };
    if (minor <= 0) return { field: "amount", text: "More than 0" };
    if (minor < p.paidMinor) return { field: "amount", text: `At least ${formatMinor(p.paidMinor, currency)}: that much is paid on it` };
    if (ruleOf(p.rule)?.needs === "date" && !p.dueOn) return { field: "dueOn", text: "Choose its date" };
    return null;
  };
  const problems = parts.map(problem);

  /** A preset fits when every part with money on it keeps at least that much (a paid one: exactly its amount). */
  const fits = (p: PlanPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    return parts.every(
      (x, i) =>
        x.paidMinor <= 0 ||
        (amounts[i] !== undefined && (x.locked ? Math.abs(amounts[i]! - minorOf(x.amount)) <= 1 : amounts[i]! >= x.paidMinor)),
    );
  };
  const chosen = (p: PlanPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    return (
      parts.length === p.parts.length &&
      p.parts.every((x, i) => parts[i]!.rule === x.rule && Math.abs(minorOf(parts[i]!.amount) - amounts[i]!) <= 1)
    );
  };
  const apply = (p: PlanPreset) => {
    const amounts = presetAmounts(p, totalMinor);
    setParts((old) =>
      p.parts.map((x, i): PlanPart => {
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
          dueDays: x.dueDays !== undefined ? String(x.dueDays) : "",
          invoice: was?.invoice ?? "",
          paidMinor: was?.paidMinor ?? 0,
          locked: false,
          note: was?.note ?? null,
        };
      }),
    );
  };
  const add = () =>
    setParts((all) => [
      ...all,
      {
        key: newKey(),
        id: null,
        label: "",
        share: diff > 0 ? shareText(diff, totalMinor) : "",
        amount: diff > 0 ? fromMinor(diff) : "",
        rule: rules[0]!.value,
        dueOn: "",
        dueDays: rules[0]!.days !== undefined ? String(rules[0]!.days) : "",
        invoice: "",
        paidMinor: 0,
        locked: false,
        note: null,
      },
    ]);

  const check = () => {
    const at = problems.findIndex(Boolean);
    if (at < 0 && diff === 0) return true;
    setTried(true);
    if (at >= 0) document.getElementById(fid(parts[at]!, problems[at]!.field))?.focus();
    return false;
  };

  const pct = totalMinor > 0 ? Number(((sum * 100) / totalMinor).toFixed(2)) : 0;
  const ok = diff === 0;
  const tones = ok ? ["bg-ok", "bg-ok/55"] : ["bg-bad", "bg-bad/55"];

  return (
    // "Why?" (a plan changed after money came in) is drawn above the parts: it keeps the form's margins.
    <ActionForm
      action={action}
      keepFields
      beforeSend={check}
      onDone={onDone}
      className="flex min-h-0 flex-1 flex-col [&>[role=alert]]:mx-5 [&>[role=alert]]:mt-4 [&>[role=alert]]:mb-0 [&>[role=alert]]:w-auto sm:[&>[role=alert]]:mx-6"
    >
      <PanelBody className="flex flex-col gap-4">
        <input type="hidden" name="payload" value={JSON.stringify(toPayload(parts))} />
        <p className="text-sm text-text-2">{intro}</p>
        {presets.length > 0 && (
          <div role="group" aria-label="Start from a usual plan" className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-text-2">Start from</span>
            {presets.map((p) => {
              const on = chosen(p);
              const can = fits(p);
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={on}
                  disabled={!can}
                  title={can ? undefined : "A paid part would change: change the parts one by one"}
                  onClick={() => apply(p)}
                  className={cn(
                    "inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-primary bg-primary-soft text-primary" : "border-line-strong bg-surface text-text hover:bg-surface-2",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
        <ol className="flex flex-col gap-3">
          {parts.map((p, n) => {
            const rule = ruleOf(p.rule);
            const bad = tried ? problems[n] : null;
            const words = hint(p);
            const remove = (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setParts((all) => all.filter((x) => x.key !== p.key))}
                disabled={parts.length === 1 || p.paidMinor > 0}
                title={p.paidMinor > 0 ? "Money is paid on it: it stays" : undefined}
                aria-label={`Remove part ${n + 1}`}
              >
                <X aria-hidden />
              </Button>
            );
            return (
              <li key={p.key} className={cn("rounded-lg border border-line p-3", p.locked ? "bg-surface-2/60" : "bg-surface")}>
                <div role="group" aria-label={`Part ${n + 1}`}>
                  <div className="mb-2 flex items-center justify-between md:hidden">
                    <span className="text-[13px] font-semibold">Part {n + 1}</span>
                    {remove}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-[1.75rem_minmax(0,1.2fr)_5rem_8rem_minmax(0,1.4fr)_8rem_2rem] md:items-end">
                    <span
                      aria-hidden
                      className="grid size-7 place-items-center rounded-full bg-text text-xs font-bold text-surface max-md:hidden md:mb-1"
                    >
                      {n + 1}
                    </span>
                    <Field
                      label="What it is"
                      htmlFor={fid(p, "label")}
                      error={bad?.field === "label" ? bad.text : undefined}
                      className="col-span-2 md:col-span-1"
                    >
                      <Input
                        id={fid(p, "label")}
                        value={p.label}
                        maxLength={80}
                        disabled={p.locked}
                        placeholder="e.g. Second part"
                        onChange={(e) => set(p.key, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="Share" htmlFor={fid(p, "share")}>
                      <div className="relative">
                        <Input
                          id={fid(p, "share")}
                          inputMode="decimal"
                          className="pr-7 tabular"
                          value={p.share}
                          disabled={p.locked}
                          onChange={(e) => {
                            const share = e.target.value;
                            const v = num(share);
                            const amount = Number.isFinite(v)
                              ? fromMinor(Math.round((totalMinor * Math.min(Math.max(v, 0), 100)) / 100))
                              : p.amount;
                            set(p.key, { share, amount, label: relabel(p.label, Number.isFinite(v) ? String(v) : "") });
                          }}
                        />
                        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
                          %
                        </span>
                      </div>
                    </Field>
                    <Field label="Amount" htmlFor={fid(p, "amount")} error={bad?.field === "amount" ? bad.text : undefined}>
                      <MoneyInput
                        id={fid(p, "amount")}
                        className="h-10"
                        currency={currency}
                        value={p.amount}
                        disabled={p.locked}
                        onChange={(e) => {
                          const amount = e.target.value;
                          const share = shareText(minorOf(amount), totalMinor);
                          set(p.key, { amount, share, label: relabel(p.label, share) });
                        }}
                      />
                    </Field>
                    <Field label="When" htmlFor={fid(p, "rule")} className="col-span-2 md:col-span-1">
                      <Select
                        id={fid(p, "rule")}
                        value={p.rule}
                        disabled={p.locked}
                        onChange={(e) => {
                          const next = ruleOf(e.target.value);
                          set(p.key, {
                            rule: e.target.value,
                            ...(next?.needs === "days" && !p.dueDays ? { dueDays: String(next.days ?? 0) } : {}),
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
                      <Field
                        label="Date"
                        htmlFor={fid(p, "dueOn")}
                        error={bad?.field === "dueOn" ? bad.text : undefined}
                        className="col-span-2 md:col-span-1"
                      >
                        <Input
                          id={fid(p, "dueOn")}
                          type="date"
                          value={p.dueOn}
                          disabled={p.locked}
                          onChange={(e) => set(p.key, { dueOn: e.target.value })}
                        />
                      </Field>
                    ) : rule?.needs === "days" ? (
                      <Field label="Days after" htmlFor={fid(p, "dueDays")} className="col-span-2 md:col-span-1">
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
                      <span className="max-md:hidden md:mb-2.5 md:text-[13px] md:text-muted">Dated by the rule</span>
                    )}
                    <span className="max-md:hidden md:mb-0.5">{remove}</span>
                  </div>
                  {(invoices || words || p.note) && (
                    <div className="mt-2.5 flex flex-col gap-2 md:flex-row md:items-end md:gap-3 md:pl-[2.5rem]">
                      {invoices && (
                        <Field label="Their invoice no." htmlFor={fid(p, "invoice")} optional className="md:w-56 md:shrink-0">
                          <Input
                            id={fid(p, "invoice")}
                            maxLength={60}
                            value={p.invoice}
                            placeholder="If they sent one"
                            onChange={(e) => set(p.key, { invoice: e.target.value })}
                          />
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
        <Button size="sm" variant="ghost" className="w-fit" onClick={add} disabled={parts.length >= 12}>
          <Plus aria-hidden /> Add a part
        </Button>
      </PanelBody>
      {/* Under the parts, outside the scrolling: the sum stays in view above Save. */}
      <PanelActions className="static mx-0 mb-0 justify-end sm:mx-0">
        <div className={cn("flex basis-full items-center gap-3 rounded-lg px-3 py-2", ok ? "bg-ok-soft" : "bg-bad-soft")}>
          <b role="status" className={cn("text-[13px] whitespace-nowrap tabular", ok ? "text-ok" : "text-bad")}>
            {ok
              ? `Adds up: 100% · ${formatMinor(totalMinor, currency)}`
              : diff > 0
                ? `${formatMinor(diff, currency)} short · ${pct}%`
                : `${formatMinor(-diff, currency)} over · ${pct}%`}
          </b>
          <span aria-hidden className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-black/10">
            {parts.map((p, i) => (
              <i
                key={p.key}
                className={cn("block h-full", tones[i % 2])}
                style={{
                  width: `${totalMinor > 0 ? Math.max(Math.min((minorOf(p.amount) * 100) / Math.max(totalMinor, sum), 100), 0) : 0}%`,
                }}
              />
            ))}
          </span>
        </div>
        {tried && (problems.some(Boolean) || !ok) && (
          <p role="alert" className="basis-full text-[13px] font-medium text-bad">
            {!ok
              ? `The parts must add up to ${formatMinor(totalMinor, currency)}: ${diff > 0 ? `${formatMinor(diff, currency)} short` : `${formatMinor(-diff, currency)} over`}.`
              : "Fix the part marked in red."}
          </p>
        )}
        <span className="mr-auto text-xs text-muted max-md:hidden">Ctrl+Enter saves · Esc closes</span>
        <Button variant="ghost" onClick={() => (close ? close() : onDone())}>
          Cancel
        </Button>
        <SubmitButton pendingText="Saving…">Save the plan</SubmitButton>
      </PanelActions>
    </ActionForm>
  );
}

/** The editor in the form that comes over the page, opened by its button. */
function PlanEditWindow({
  label,
  title,
  sub,
  editor,
}: {
  label: string;
  title: string;
  sub: string;
  editor: Omit<Parameters<typeof PlanEditor>[0], "onDone">;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" className="h-8 px-2.5 text-[13px]" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <SidePanel title={title} description={sub} onClose={() => setOpen(false)} className="md:w-[920px]">
          <PlanEditor {...editor} onDone={() => setOpen(false)} />
        </SidePanel>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- the customer's plan */

const CUSTOMER_RULES: PlanRule[] = [
  { value: "fixed", label: "On a date", needs: "date" },
  { value: "on_ready", label: "On the ready date" },
  { value: "on_ship_plus_days", label: "Days after shipping", needs: "days", days: 14 },
  { value: "after_papers", label: "After the papers (LC)", needs: "days", days: 0 },
  { value: "", label: "No date yet" },
];

/** "Edit plan" on the order's Payment tab: the customer's parts, each with its payment request. */
export function CustomerPlanWindow({
  sub,
  action,
  plan,
  currency,
  total,
  customer,
  today,
}: {
  sub: string;
  action: Action;
  plan: OrderMoney["plan"];
  currency: string;
  total: string;
  customer: string;
  today: string;
}) {
  const { date, dayMonth } = useTime();
  const totalMinor = toMinor(total);
  const d = plan.dates;
  const depositOn = plan.items.find((i) => i.dueRule === "fixed" && i.dueOn)?.dueOn ?? addDays(today, 7);
  const start: PlanPart[] = plan.items.map((i) => {
    const r = i.request;
    const paidMinor = toMinor(i.paid);
    const note =
      r.state === "paid"
        ? { text: "Paid in full: it stays as it was paid." }
        : r.state === "part_paid"
          ? { text: `${money(i.paid, currency)} is paid on it: it cannot be less. Changing it asks why.`, warn: true }
          : r.with === "request" && r.sentOn
            ? { text: `Request sent on ${date(r.sentOn)}. If you change it, send it again (R${(r.revision ?? 1) + 1}).`, warn: true }
            : r.through === "bank"
              ? { text: "Asked for with the shipping papers through the banks, not with a request." }
              : null;
    return {
      key: i.id,
      id: i.id,
      label: i.label,
      share: shareText(toMinor(i.amount), totalMinor),
      amount: i.amount,
      rule: i.dueRule ?? (i.dueOn ? "fixed" : ""),
      dueOn: i.dueRule === "fixed" || !i.dueRule ? (i.dueOn ?? "") : "",
      dueDays: i.dueDays === null ? "" : String(i.dueDays),
      invoice: "",
      paidMinor,
      locked: r.state === "paid",
      note,
    };
  });
  const after = (on: string | null, days: string) => (on ? ` (${dayMonth(addDays(on, Number(days) || 0))})` : "");
  return (
    <PlanEditWindow
      label="Edit plan"
      title="Payment plan"
      sub={sub}
      editor={{
        intro: (
          <>
            {customer} pays <b className="font-semibold text-text tabular">{money(total, currency)}</b> for this order. Each part gets its
            own payment request.
          </>
        ),
        totalMinor,
        currency,
        rules: CUSTOMER_RULES,
        presets: [
          {
            label: "30% now · 70% before shipment",
            parts: [
              { name: "Deposit", share: 30, rule: "fixed", dueOn: depositOn },
              { name: "Balance", share: 70, rule: "on_ready" },
            ],
          },
          {
            label: "50 / 50",
            parts: [
              { name: "Deposit", share: 50, rule: "fixed", dueOn: depositOn },
              { name: "Balance", share: 50, rule: "on_ready" },
            ],
          },
          { label: "All before shipment", parts: [{ name: "Payment before shipment", share: 100, rule: "on_ready" }] },
          {
            label: "All against the B/L copy",
            parts: [{ name: "Payment against B/L copy", share: 100, rule: "on_ship_plus_days", dueDays: 14 }],
          },
        ],
        start,
        hint: (p) =>
          p.rule === "on_ready"
            ? `Its date is the ready date${d.readyOn ? ` (${dayMonth(d.readyOn)})` : ", not known yet"}: when that moves, so does the due day.`
            : p.rule === "on_ship_plus_days"
              ? `${Number(p.dueDays) || 0} days after the goods leave${after(d.shippedOn, p.dueDays)}: when shipping moves, so does the due day.`
              : p.rule === "after_papers"
                ? `${Number(p.dueDays) || 0} days after the papers reach their bank${after(d.papersOn, p.dueDays)}.`
                : p.rule === ""
                  ? "No date yet: it is not chased until it has one."
                  : null,
        action,
        toPayload: (parts) => ({
          items: parts.map((p) => ({
            id: p.id,
            label: p.label.trim(),
            amount: fromMinor(minorOf(p.amount)),
            dueRule: p.rule || null,
            dueOn: p.rule === "fixed" ? p.dueOn || null : null,
            ...(p.rule === "on_ship_plus_days" || p.rule === "after_papers" ? { dueDays: p.dueDays || "0" } : {}),
          })),
        }),
      }}
    />
  );
}

/* ---------------------------------------------------------------- a supplier's plan */

const SUPPLIER_RULES: PlanRule[] = [
  { value: "on_order", label: "When we order" },
  { value: "on_ready", label: "When they say ready" },
  { value: "fixed", label: "On a fixed date", needs: "date" },
  { value: "on_ship_plus_days", label: "Days after shipping", needs: "days", days: 30 },
];

/** "Edit plan" (and "Change") on Factory order: what we pay one supplier, in parts, with their invoice numbers. */
export function SupplierPlanWindow({
  label,
  sub,
  action,
  plan,
  orderedOn,
}: {
  label: string;
  sub: string;
  action: Action;
  plan: FactoryPlanView;
  /** The day we ordered from the factory ("when we order" parts fall due then). */
  orderedOn: string | null;
}) {
  const { dayMonth } = useTime();
  const totalMinor = toMinor(plan.owed);
  const c = plan.currency;
  const start: PlanPart[] = plan.rows.map((r, i) => {
    const paidMinor = toMinor(r.paid);
    const locked = r.status === "paid" && toMinor(r.amount) > 0;
    return {
      key: r.id ?? `part-${i}`,
      id: r.id,
      label: r.label,
      share: r.percent !== null ? String(Number(r.percent.toFixed(2))) : shareText(toMinor(r.amount), totalMinor),
      amount: r.amount,
      rule: r.dueRule,
      dueOn: r.dueRule === "fixed" ? (r.dueOn ?? "") : "",
      dueDays: r.dueDays === null || r.dueDays === undefined ? "" : String(r.dueDays),
      invoice: r.supplierRef ?? "",
      paidMinor,
      locked,
      note: locked
        ? { text: `Paid (${money(r.paid, c)}): it stays as it was paid.` }
        : paidMinor > 0
          ? { text: `${money(r.paid, c)} is paid on it: it cannot be less.`, warn: true }
          : null,
    };
  });
  return (
    <PlanEditWindow
      label={label}
      title={`Paying ${plan.factory.name}`}
      sub={sub}
      editor={{
        intro: (
          <>
            We owe {plan.factory.name} <b className="font-semibold text-text tabular">{money(plan.owed, c)}</b> for this order.
            {Number(plan.paid) > 0 && (
              <>
                {" "}
                <b className="font-semibold text-text tabular">{money(plan.paid, c)}</b> is paid: what is paid stays.
              </>
            )}
            {!plan.saved && " This is the company's usual plan until it is saved."}
          </>
        ),
        totalMinor,
        currency: c,
        rules: SUPPLIER_RULES,
        presets: [
          {
            label: "30% when we order · 70% when ready",
            parts: [
              { name: "Advance", share: 30, rule: "on_order" },
              { name: "Balance", share: 70, rule: "on_ready" },
            ],
          },
          {
            label: "50 / 50",
            parts: [
              { name: "Advance", share: 50, rule: "on_order" },
              { name: "Balance", share: 50, rule: "on_ready" },
            ],
          },
          { label: "All when ready", parts: [{ name: "Payment", share: 100, rule: "on_ready" }] },
          { label: "All after shipping", parts: [{ name: "Payment after shipping", share: 100, rule: "on_ship_plus_days", dueDays: 30 }] },
        ],
        start,
        invoices: true,
        hint: (p) =>
          p.rule === "on_order"
            ? `Due the day we order${orderedOn ? ` (${dayMonth(orderedOn)})` : ""}.`
            : p.rule === "on_ready"
              ? `Its date comes from this supplier's ready date${plan.readyOn ? ` (${dayMonth(plan.readyOn)})` : ", not known yet"}: when that moves, so does the due day.`
              : p.rule === "on_ship_plus_days"
                ? `${Number(p.dueDays) || 0} days after the goods leave: dated once they have.`
                : null,
        action,
        toPayload: (parts) => ({
          factoryId: plan.factory.id,
          items: parts.map((p) => {
            const share = num(p.share);
            return {
              label: p.label.trim(),
              percent: Number.isFinite(share) ? Math.min(Math.max(Number(share.toFixed(2)), 0), 100) : null,
              amount: fromMinor(minorOf(p.amount)),
              dueRule: p.rule,
              dueOn: p.rule === "fixed" ? p.dueOn || null : null,
              ...(p.rule === "on_ship_plus_days" ? { dueDays: p.dueDays || "0" } : {}),
              supplierRef: p.invoice.trim() || null,
            };
          }),
        }),
      }}
    />
  );
}
