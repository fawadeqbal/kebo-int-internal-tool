import Link from "next/link";
import { FLOW_STEP_LABEL, type FlowStep } from "@kebo/shared";
import { PROFIT_LABEL } from "@kebo/money";
import { Alert, buttonClass, Card, CardHeader, cn, Segmented } from "@kebo/ui";
import { orderHistoryOf, orderOf } from "@/lib/order-data";
import { money } from "@/lib/format";
import { optional } from "@/components/print/data";
import { StepChanges } from "@/components/orders/step-page";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { AddOrderExpense } from "@/components/orders/expense-form";
import { CostsExcel, ExpensesTable, PlannedTable, RepayButton } from "@/components/orders/costs-tables";
import { today } from "@/components/orders/today";

export const metadata = { title: "Order · costs" };

/** A label / amount line of the profit card. */
function Line({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t border-line pt-2.5")}>
      <dt className={cn("text-xs", strong ? "font-semibold text-text" : "text-text-2")}>{label}</dt>
      <dd className={cn("text-right tabular", strong ? "font-bold" : "font-medium", tone)}>{value}</dd>
    </div>
  );
}

/**
 * The order's costs (managers with the expenses feature): what the quote
 * planned against what was spent, every expense by step with its receipt,
 * the profit now expected, who to repay, and the changes.
 */
export default async function OrderCostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; missing?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const o = await orderOf(id);
  const data = await orderCostsSetup(id);
  const base = `/orders/${o.id}`;
  if (!data)
    return (
      <Card>
        <CardHeader title="Costs" description="Only managers with expenses switched on for the company see an order's costs and profit." />
      </Card>
    );
  const { costs, setup, money: m } = data;
  const c = costs.currency;
  const steps = setup.steps;
  const step = steps.some((s) => s.key === sp.step) ? (sp.step as FlowStep) : null;
  const missing = sp.missing === "1";
  const shown = costs.expenses.filter((e) => (!step || e.step === step) && (!missing || (!e.receipt && !e.voided)));
  const href = (q: { step?: string | null; missing?: boolean }) => {
    const p = new URLSearchParams();
    if (q.step) p.set("step", q.step);
    if (q.missing) p.set("missing", "1");
    const s = p.toString();
    return `${base}/costs${s ? `?${s}` : ""}#expenses`;
  };
  const history = (await optional(() => orderHistoryOf(id, undefined, 60))) ?? [];
  const changes = history.filter((h) => h.action.startsWith("expense")).slice(0, 4);
  const p = costs.profit;
  const kinds = costs.totals.notPlannedKinds.map((k) => k.toLowerCase());
  const missingAmounts = costs.totals.receiptsMissingAmounts.map((a) => money(a.amount, a.currency)).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="Costs at a glance"
        className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-center"
      >
        <div>
          <p className="text-xs text-text-2">Planned on the quote</p>
          <p className="text-xl font-bold tabular">{money(costs.totals.planned, c)}</p>
          <p className="text-xs text-muted">
            {costs.planned
              .filter((r) => r.planned !== null)
              .map((r) => r.label.toLowerCase())
              .join(", ") || "nothing planned"}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-2">Spent so far</p>
          <p className="text-xl font-bold tabular">{money(costs.totals.spent, c)}</p>
          <p className="text-xs text-muted">
            {costs.totals.count} expense{costs.totals.count === 1 ? "" : "s"}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-2">Not planned</p>
          <p className={cn("text-xl font-bold tabular", Number(costs.totals.notPlanned) > 0 && "text-bad")}>{money(costs.totals.notPlanned, c)}</p>
          <p className="text-xs text-muted">{kinds.length ? kinds.join(", ") : "all within the plan"}</p>
        </div>
        <div>
          <p className="text-xs text-text-2">Receipts missing</p>
          <p className={cn("text-xl font-bold tabular", costs.totals.receiptsMissing > 0 && "text-warn")}>{costs.totals.receiptsMissing}</p>
          <p className="text-xs text-muted">{missingAmounts || "all in"}</p>
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 lg:col-span-1 lg:justify-end">
          <CostsExcel costs={costs} />
          <AddOrderExpense setup={setup} step={null} />
        </div>
      </section>

      {costs.missingRate && (
        <Alert tone="warning">There is no exchange rate for {costs.missingRate} in Settings, so expenses cannot be turned into it.</Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Planned and spent" />
            <div className="flex flex-col gap-3 p-4">
              <p className="text-xs text-text-2">
                Planned costs come from the quote. Freight, transport to the port, insurance and customs count against them first.
              </p>
              <PlannedTable costs={costs} />
            </div>
          </Card>

          <Card id="expenses">
            <CardHeader title="Expenses" actions={<AddOrderExpense setup={setup} step={step} variant="ghost" size="xs" />} />
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented
                  label="Show the expenses of"
                  options={[
                    { href: href({ missing }), label: "All", active: !step },
                    ...steps.map((s) => ({
                      href: href({ step: s.key, missing }),
                      label: s.key === "documents" ? "Docs & bank" : s.key === "delivery" ? "Delivery" : FLOW_STEP_LABEL[s.key],
                      active: step === s.key,
                    })),
                  ]}
                />
                <Link
                  href={href({ step, missing: !missing })}
                  aria-current={missing ? "true" : undefined}
                  className={cn("text-xs", missing ? "font-semibold text-primary" : "text-text-2 hover:text-text")}
                >
                  Missing receipts ({costs.totals.receiptsMissing})
                </Link>
              </div>
              <ExpensesTable costs={costs} expenses={shown} setup={setup} />
            </div>
          </Card>

          {m?.dealExpenses && m.dealExpenses.length > 0 && (
            <Card>
              <CardHeader
                title="Spent before the order"
                description="Trips, samples and visits for the inquiry before it was won (not in the costs above)."
                actions={
                  <Link href={`/inquiries/${m.deal.id}`} className={buttonClass("ghost", "xs")}>
                    Open the inquiry
                  </Link>
                }
              />
              <ul className="flex flex-col divide-y divide-line px-4">
                {m.dealExpenses
                  .filter((e) => !e.voided)
                  .map((e) => (
                    <li key={e.id} className="flex justify-between gap-3 py-2.5 text-sm">
                      <span>{e.description}</span>
                      <span className="tabular text-text-2">{money(e.amount, e.currency)}</span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>

        <aside aria-label="Beside the costs" className="flex min-w-0 flex-col gap-5">
          {p && (
            <Card>
              <CardHeader title="Profit on this order" />
              <dl className="flex flex-col gap-2.5 px-4 py-3.5 text-sm">
                <Line label={Number(p.uncosted) > 0 ? "Sale (lines with a cost)" : "Sale"} value={money(p.sale, c)} />
                <Line
                  label={
                    p.factoryOwed.length === 1
                      ? `Factory · ${money(p.factoryOwed[0]!.amount, p.factoryOwed[0]!.currency)}${p.factoryOwed[0]!.currency !== c && Number(p.factory) > 0 ? ` at ${(Number(p.factoryOwed[0]!.amount) / Number(p.factory)).toFixed(2)}` : ""}`
                      : "Factory"
                  }
                  value={`− ${money(p.factory, c)}`}
                />
                <Line label="Costs planned on the quote" value={`− ${money(p.planned, c)}`} />
                <Line label="Costs not planned, so far" value={`− ${money(p.notPlanned, c)}`} tone={Number(p.notPlanned) > 0 ? "text-bad" : undefined} />
                {Number(p.bankCharges) > 0 && <Line label="Bank charges on payments" value={`− ${money(p.bankCharges, c)}`} />}
                <Line
                  strong
                  label={PROFIT_LABEL.expected}
                  value={`${money(p.expected, c)}${p.margin !== null ? ` · ${p.margin.toFixed(1)}%` : ""}`}
                  tone={Number(p.expected) < 0 ? "text-bad" : undefined}
                />
              </dl>
              <p className="px-4 pb-3.5 text-xs text-muted">
                {PROFIT_LABEL.grossOnQuote}: {money(p.onQuote, c)}
                {p.onQuoteMargin !== null ? ` · ${p.onQuoteMargin.toFixed(1)}%` : ""}
                {Number(p.uncosted) > 0 ? ` · ${money(p.uncosted, c)} of the sale has no cost and is left out` : ""}
                {/* Still to pay the factories after our payments and what they bear (as on the order's money). */}
                {p.factoryOwed
                  .filter((f) => f.toPay !== undefined)
                  .map((f) => (
                    <span key={f.currency} className="block">
                      Still to pay the factory: {money(f.toPay!, f.currency)} of {money(f.amount, f.currency)}
                    </span>
                  ))}
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title="To repay" />
            {costs.toRepay.length ? (
              <ul className="flex flex-col divide-y divide-line px-4">
                {costs.toRepay.map((r) => (
                  <li key={`${r.person.id}:${r.currency}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span className="text-xs text-text-2">
                      {r.person.name} · own money
                      <span className="block text-muted">
                        {r.items.length} expense{r.items.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular">{money(r.amount, r.currency)}</span>
                      {setup.canEdit && (
                        <RepayButton orderId={o.id} ids={r.items.map((i) => i.id)} currency={r.currency} name={r.person.name} today={today()} />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3.5 text-xs text-muted">Nobody is waiting to be paid back.</p>
            )}
          </Card>

          <StepChanges title="Changes" entries={changes} historyHref={`${base}/history`} />
        </aside>
      </div>
    </div>
  );
}
