import type { ReactNode } from "react";
import { BASIS_STEP_LABEL, categoryOfItem, type BasisStep, type FlowStep } from "@kebo/shared";
import { Card, CardHeader } from "@kebo/ui";
import { date, money, whole } from "@/lib/format";
import type { ChecklistItem } from "@/lib/types-checklist";
import { AddOrderExpense } from "./expense-form";
import { orderCostsSetup } from "./costs-data";

/** The planned costs of the quote that are paid in each step. */
const PLANNED_IN: Partial<Record<FlowStep, BasisStep[]>> = {
  shipping: ["to_port", "freight", "insurance"],
  delivery: ["delivery", "duties"],
};

/**
 * "Costs in this step" on every step page (managers with the expenses
 * feature): the step's expenses, what they add up to, what the quote planned
 * for it, and Add expense.
 */
export async function StepCosts({ id, step }: { id: string; step: FlowStep }) {
  const data = await orderCostsSetup(id);
  if (!data) return null;
  const { costs, setup } = data;
  const c = costs.currency;
  const here = costs.expenses.filter((e) => e.step === step && !e.voided);
  const planned = costs.planned.filter((r) => r.basisStep && PLANNED_IN[step]?.includes(r.basisStep) && r.planned !== null);
  const total = costs.steps[step]?.spent ?? "0.00";
  const note = planned.length
    ? `Planned on the quote: ${planned.map((r) => `${BASIS_STEP_LABEL[r.basisStep!].toLowerCase()} ${whole(r.planned, c)}`).join(" · ")}.`
    : here.some((e) => e.borneBy === "us")
      ? "Nothing was planned for this step, so these cut the profit."
      : null;
  return (
    <Card aria-label="Costs in this step" data-target="costs" data-target-card="">
      <CardHeader
        title="Costs in this step"
        actions={<AddOrderExpense setup={setup} step={step} variant="ghost" size="xs" />}
      />
      {here.length ? (
        <ul className="flex flex-col divide-y divide-line px-4">
          {here.map((e) => (
            <li key={e.id} data-target={`costs.${e.category}`} className="flex items-start justify-between gap-3 py-2.5 text-xs">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{e.description}</span>
                <span className="block text-muted">
                  {date(e.spentOn)}
                  {e.paidBy ? ` · ${e.paidBy.name}` : ""}
                  {e.ownMoney ? ", own money" : e.account ? `, ${e.account.name}` : ""}
                  {e.borneBy === "customer" ? " · charged to the customer" : e.borneBy === "factory" ? " · the factory bears it" : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm tabular text-text-2">{money(e.amount, e.currency)}</span>
                {!e.receipt && <span className="block text-warn">no receipt</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-3.5 text-xs text-muted">No expense on this step yet.</p>
      )}
      <div className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-3 text-sm">
        <span className="text-xs text-text-2">Spent in this step</span>
        <span className="font-semibold tabular">{money(total, c)}</span>
      </div>
      {note && <p className="px-4 pb-3.5 text-xs text-text-2">{note}</p>}
    </Card>
  );
}

/**
 * The checklist's own Pay items that record an expense (freight, to the port,
 * inspection…): each opens the order's expense form filled in with its kind,
 * its title and its step. Keyed by item id; other Pay items keep the step's
 * payment form.
 */
export async function expensePayTools(id: string, items: ChecklistItem[]): Promise<Record<string, ReactNode>> {
  const data = await orderCostsSetup(id);
  const out: Record<string, ReactNode> = {};
  if (!data) return out;
  for (const i of items) {
    if (i.auto || i.tool !== "pay" || !i.id || i.done || i.skipped) continue;
    const category = categoryOfItem(i.title);
    if (!category) continue;
    out[i.id] = (
      <AddOrderExpense
        setup={data.setup}
        step={i.step}
        prefill={{ category, description: i.title, step: i.step }}
        label="Pay"
        variant="secondary"
        size="xs"
      />
    );
  }
  return out;
}
