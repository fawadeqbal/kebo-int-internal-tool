"use client";

import { EditButton } from "@/components/common/edit-button";
import { useId, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { fromMinor, toMinor } from "@kebo/money";
import { addDays } from "@kebo/utils";
import { Button, RULES } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import {
  freshPart,
  minorOf,
  num,
  partProblem,
  PartsEditor,
  PartsSummary,
  shareText,
  sumProblem,
  type EditorPart,
  type PartPreset,
  type PartRule,
} from "@/components/common/parts-editor";
import { PanelBody, SidePanel, WindowCancelIn, WindowFooter } from "@/components/common/panel";
import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import type { ActionState } from "@/lib/actions";
import type { FactoryPlanView, OrderMoney } from "@/lib/types-money";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export type PlanRule = PartRule;
export type PlanPart = EditorPart;
export type PlanPreset = PartPreset;

/**
 * The plan in its window: the one installments editor (components/common/parts-editor), the form around it and
 * the sum above Save. A part paid in full stays as it was paid; a part paid in part cannot go below what was
 * paid. Save checks the sum first.
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
  const [parts, setParts] = useState<PlanPart[]>(() => (start.length ? start : [freshPart(totalMinor, totalMinor, rules[0]!)]));
  const [tried, setTried] = useState(false);
  const problems = parts.map((p) => partProblem(p, rules, currency));
  const wrong = sumProblem(parts, totalMinor, currency);
  const check = () => {
    const at = problems.findIndex(Boolean);
    if (at < 0 && !wrong) return true;
    setTried(true);
    if (at >= 0) document.getElementById(`${base}-${parts[at]!.key}-${problems[at]!.field}`)?.focus();
    return false;
  };
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
        <PartsEditor
          parts={parts}
          onChange={setParts}
          totalMinor={totalMinor}
          currency={currency}
          rules={rules}
          presets={presets}
          idPrefix={base}
          invoices={invoices}
          hint={hint}
          problems={tried ? problems : undefined}
        />
      </PanelBody>
      {/* Under the parts, outside the scrolling: the sum stays in view above Save. */}
      <WindowFooter outside cancel={false}>
        <PartsSummary parts={parts} onChange={setParts} totalMinor={totalMinor} currency={currency} />
        {tried && (problems.some(Boolean) || wrong) && (
          <p role="alert" className="basis-full text-md font-medium text-bad">
            {wrong ?? "Correct the installment marked in red."}
          </p>
        )}
        <span className="mr-auto text-xs text-muted max-md:hidden">Ctrl+Enter saves · Esc closes</span>
        <WindowCancelIn />
        <SubmitButton pendingText="Saving…">Save plan</SubmitButton>
      </WindowFooter>
    </ActionForm>
  );
}

/** The editor in the form that comes over the page, opened by its button. */
function PlanEditWindow({
  label,
  title,
  sub,
  editor,
  create,
}: {
  label: string;
  title: string;
  sub: string;
  editor: Omit<Parameters<typeof PlanEditor>[0], "onDone">;
  /** No plan yet: the button says "Create payment plan" (the same editor, one blank installment holding the total). */
  create?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {create ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Create payment plan
        </Button>
      ) : (
        <EditButton label={label} onClick={() => setOpen(true)} />
      )}
      {open && (
        <SidePanel title={title} description={sub} onClose={() => setOpen(false)} className={RULES.window.table}>
          <PlanEditor {...editor} onDone={() => setOpen(false)} />
        </SidePanel>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- the customer's plan */

const CUSTOMER_RULES: PlanRule[] = [
  { value: "fixed", label: "On a date", needs: "date" },
  { value: "on_ready", label: "On goods ready" },
  { value: "on_ship_plus_days", label: "Days after shipment", needs: "days", days: 14 },
  { value: "after_papers", label: "After the documents (LC)", needs: "days", days: 0 },
  { value: "after_sat", label: "After the site test (SAT)", needs: "days", days: 0 },
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
              ? { text: "Asked for with the shipping documents through the banks, not with a request." }
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
      title="Customer payment plan"
      sub={sub}
      create={plan.items.length === 0}
      editor={{
        intro: (
          <>
            Customer payments from {customer}: total <b className="font-semibold text-text tabular">{money(total, currency)}</b>. Each
            installment gets its own payment request.
          </>
        ),
        totalMinor,
        currency,
        rules: CUSTOMER_RULES,
        presets: [
          {
            label: "30% on confirmation · 70% before shipment",
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
          { label: "100% before shipment", parts: [{ name: "Payment before shipment", share: 100, rule: "on_ready" }] },
          {
            label: "100% against B/L copy",
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
                ? `${Number(p.dueDays) || 0} days after the documents reach their bank${after(d.papersOn, p.dueDays)}.`
                : p.rule === "after_sat"
                  ? `${Number(p.dueDays) || 0} days after the site test is done${after(d.satOn ?? null, p.dueDays)}: dated once it is.`
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
            ...(p.rule === "on_ship_plus_days" || p.rule === "after_papers" || p.rule === "after_sat" ? { dueDays: p.dueDays || "0" } : {}),
          })),
        }),
      }}
    />
  );
}

/* ---------------------------------------------------------------- a supplier's plan */

const SUPPLIER_RULES: PlanRule[] = [
  { value: "on_order", label: "On order placement" },
  { value: "on_ready", label: "On goods ready" },
  { value: "fixed", label: "On a fixed date", needs: "date" },
  { value: "on_ship_plus_days", label: "Days after shipment", needs: "days", days: 30 },
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
      title={`Supplier payment plan · ${plan.factory.name}`}
      sub={sub}
      create={plan.rows.length === 0}
      editor={{
        intro: (
          <>
            Payable to {plan.factory.name}: <b className="font-semibold text-text tabular">{money(plan.owed, c)}</b>.
            {Number(plan.paid) > 0 && (
              <>
                {" "}
                <b className="font-semibold text-text tabular">{money(plan.paid, c)}</b> is settled and remains as paid.
              </>
            )}
            {!plan.saved && " This is the company's standard plan until it is saved."}
          </>
        ),
        totalMinor,
        currency: c,
        rules: SUPPLIER_RULES,
        presets: [
          {
            label: "30% on order placement · 70% on goods ready",
            parts: [
              { name: "Deposit", share: 30, rule: "on_order" },
              { name: "Balance", share: 70, rule: "on_ready" },
            ],
          },
          {
            label: "50 / 50",
            parts: [
              { name: "Deposit", share: 50, rule: "on_order" },
              { name: "Balance", share: 50, rule: "on_ready" },
            ],
          },
          { label: "100% on goods ready", parts: [{ name: "Payment", share: 100, rule: "on_ready" }] },
          { label: "100% after shipment", parts: [{ name: "Payment after shipping", share: 100, rule: "on_ship_plus_days", dueDays: 30 }] },
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
