import Link from "next/link";
import { can, COST_ROW_STATUS_LABEL, ORDER_TAB_LABEL, type CostRowStatus, type FlowStep } from "@kebo/shared";
import { PROFIT_LABEL } from "@kebo/money";
import { Alert, Badge, buttonClass, cn, Segmented, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { money, whole } from "@/lib/format";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { RepayWindow } from "@/components/order-sections/costs-windows";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { AddOrderExpense } from "@/components/orders/expense-form";
import { CostsExcel, ExpensesTable } from "@/components/orders/costs-tables";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · costs" };

const n2 = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_TONE: Record<CostRowStatus, "neutral" | "ok" | "warn" | "bad" | "info"> = { not_spent: "neutral", within: "info", spent: "ok", over: "warn", not_planned: "warn" };
const dash = <span className="text-muted">—</span>;

/** One of the four figures at the top. */
function Figure({ label, value, sub, tone, first }: { label: string; value: string; sub: string; tone?: "ok" | "warn" | "bad"; first?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 px-[18px] py-3.5", !first && "border-line max-sm:border-t sm:border-l")}>
      <span className="text-xs text-text-2">{label}</span>
      <span className={cn("text-lg font-bold tabular", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</span>
      <span className="text-xs text-text-2">{sub}</span>
    </div>
  );
}

/**
 * Costs (design "the order, final"; managers with the expenses feature): four figures, what was planned
 * against what was spent with where each number comes from, every expense with its receipt, and who is
 * still to be repaid. An expense is added here and nowhere else on the order.
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
  const d = await stageData(id);
  const { me, o, base, now } = d;
  const data = await orderCostsSetup(id);
  if (!data)
    return (
      <OrderPage id={id}>
        <EmptySection title="Costs" text="Only managers with expenses switched on for the company see an order’s costs and profit." />
      </OrderPage>
    );
  const { costs, setup, money: m } = data;
  const c = costs.currency;
  const p = costs.profit;
  const steps = setup.steps;
  const step = steps.some((s) => s.key === sp.step) ? (sp.step as FlowStep) : null;
  const missing = sp.missing === "1";
  const shown = costs.expenses.filter((e) => (!step || e.step === step) && (!missing || (!e.receipt && !e.voided)));
  const href = (q: { step?: string | null; missing?: boolean }) => {
    const u = new URLSearchParams();
    if (q.step) u.set("step", q.step);
    if (q.missing) u.set("missing", "1");
    const s = u.toString();
    return `${base}/costs${s ? `?${s}` : ""}#expenses`;
  };

  // The goods: what the factories charge (in the order's currency, as costed) and the share of it already paid.
  const owed = p?.factoryOwed ?? [];
  const one = owed.length === 1 && owed[0]!.toPay !== undefined && Number(owed[0]!.amount) > 0 ? owed[0]! : null;
  const goodsPlanned = p ? Number(p.factory) : 0;
  const goodsSpent = p && one ? Math.round(goodsPlanned * (1 - Number(one.toPay) / Number(one.amount)) * 100) / 100 : null;
  const goodsState = goodsSpent === null ? null : goodsSpent <= 0 ? "Not paid yet" : goodsSpent < goodsPlanned ? "Part paid" : "Paid";

  const ours = Number(costs.totals.borneByUs);
  const planned = goodsPlanned + Number(costs.totals.planned);
  const spent = (goodsSpent ?? 0) + ours;
  const over = Number(costs.totals.notPlanned);
  const dealSpent = (m?.dealExpenses ?? []).filter((e) => !e.voided);

  return (
    <OrderPage id={id}>
      <section aria-label="Costs at a glance" className="grid min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card sm:grid-cols-2 xl:grid-cols-4">
        {p ? (
          <>
            <Figure first label="Order total" value={whole(o.total, o.currency)} sub={Number(o.money.due) <= 0 ? "received in full" : `${whole(o.money.received, o.currency)} received`} />
            <Figure label="Planned cost" value={whole(planned, c)} sub="from the quotation" />
            <Figure
              label="Spent so far"
              value={whole(spent, c)}
              sub={over > 0 ? `${money(over, c)} not planned` : planned > 0 ? `${Math.round((spent / planned) * 100)}% of the plan` : `${costs.totals.count} expense${costs.totals.count === 1 ? "" : "s"}`}
              tone={over > 0 ? "warn" : undefined}
            />
            <Figure
              label={PROFIT_LABEL.expected}
              value={whole(p.expected, c)}
              sub={[p.margin !== null ? `${p.margin.toFixed(1)}%` : null, p.onQuoteMargin !== null ? `planned ${p.onQuoteMargin.toFixed(1)}%` : null].filter(Boolean).join(" · ") || "—"}
              tone={Number(p.expected) < 0 ? "bad" : "ok"}
            />
          </>
        ) : (
          <>
            <Figure first label="Planned cost" value={whole(costs.totals.planned, c)} sub="from the quotation" />
            <Figure label="Spent so far" value={whole(costs.totals.spent, c)} sub={`${costs.totals.count} expense${costs.totals.count === 1 ? "" : "s"}`} />
          </>
        )}
      </section>

      {costs.missingRate && <Alert tone="warning">There is no exchange rate for {costs.missingRate} in Settings, so expenses cannot be turned into it.</Alert>}

      <Section title="Planned and spent" state={over > 0 ? `${money(over, c)} over` : ours > 0 || (goodsSpent ?? 0) > 0 ? "As planned" : "Nothing spent yet"} tone={over > 0 ? "warn" : ours > 0 || (goodsSpent ?? 0) > 0 ? "ok" : "neutral"}>
        <Table className="min-w-[640px]">
          <THead>
            <tr>
              <Th>Cost</Th>
              <Th className="text-right">Planned {c}</Th>
              <Th className="text-right">Spent {c}</Th>
              <Th className="text-right">Difference</Th>
              <Th>From</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {p && goodsPlanned > 0 && (
              <Tr>
                <Td className="font-semibold">
                  Goods from the factory
                  {owed.some((f) => f.currency !== c) && <span className="block text-xs font-normal text-text-2">{owed.map((f) => money(f.amount, f.currency)).join(" + ")}</span>}
                </Td>
                <Td className="text-right tabular">{n2(goodsPlanned)}</Td>
                <Td className="text-right tabular">{goodsSpent === null ? dash : n2(goodsSpent)}</Td>
                <Td className="text-right tabular">{goodsSpent === null ? dash : `${n2(goodsPlanned - goodsSpent)} left`}</Td>
                <Td>
                  <Link href={`${base}/factory`} className="text-text-2 hover:text-primary hover:underline">
                    {ORDER_TAB_LABEL.factory}
                  </Link>
                </Td>
                <Td>{goodsState ? <Badge tone={goodsState === "Paid" ? "ok" : goodsState === "Part paid" ? "info" : "neutral"}>{goodsState}</Badge> : dash}</Td>
              </Tr>
            )}
            {costs.planned.map((r) => (
              <Tr key={r.key}>
                <Td className="font-semibold">
                  {r.label}
                  {r.note && <span className="block text-xs font-normal text-text-2">{r.note}</span>}
                </Td>
                <Td className="text-right tabular">{r.planned ? n2(r.planned) : dash}</Td>
                <Td className="text-right tabular">{Number(r.spent) ? n2(r.spent) : dash}</Td>
                <Td className={cn("text-right whitespace-nowrap tabular", Number(r.difference) < 0 && "font-semibold text-warn")}>
                  {!Number(r.spent) && !r.planned ? dash : Number(r.difference) >= 0 ? `${n2(r.difference)} left` : `${n2(-Number(r.difference))} over`}
                </Td>
                <Td className="text-text-2">Expenses</Td>
                <Td>
                  <Badge tone={STATUS_TONE[r.status]} className="whitespace-nowrap">
                    {COST_ROW_STATUS_LABEL[r.status]}
                  </Badge>
                </Td>
              </Tr>
            ))}
            {!costs.planned.length && !(p && goodsPlanned > 0) && (
              <Tr>
                <Td colSpan={6} className="text-text-2">
                  Nothing was planned on the quotation and nothing spent yet.
                </Td>
              </Tr>
            )}
          </tbody>
          {(costs.planned.length > 0 || (p && goodsPlanned > 0)) && (
            <tfoot>
              <tr className="border-t border-line bg-surface-2/60 text-[13px] font-semibold">
                <Td>Total {c}</Td>
                <Td className="text-right tabular">{n2(planned)}</Td>
                <Td className="text-right tabular">{n2(spent)}</Td>
                <Td className={cn("text-right whitespace-nowrap tabular", over > 0 && "text-warn")}>{over > 0 ? `${n2(over)} not planned` : ""}</Td>
                <Td />
                <Td />
              </tr>
            </tfoot>
          )}
        </Table>
      </Section>

      <Section
        id="expenses"
        title="Expenses"
        state={
          costs.totals.count === 0
            ? "No expense yet"
            : `${costs.totals.count} expense${costs.totals.count === 1 ? "" : "s"}${costs.totals.receiptsMissing ? ` · ${costs.totals.receiptsMissing} receipt${costs.totals.receiptsMissing === 1 ? "" : "s"} missing` : ""}`
        }
        tone={costs.totals.receiptsMissing ? "warn" : "neutral"}
        actions={
          <>
            <CostsExcel costs={costs} />
            <AddOrderExpense setup={setup} step={step} label="Add an expense" />
          </>
        }
        files={<SectionFiles orderId={o.id} section="expenses" canAdd={d.canFiles} />}
      >
        <div className="flex flex-col gap-3 border-t border-line px-[18px] py-3">
          {costs.totals.count > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                label="Show the expenses of"
                options={[{ href: href({ missing }), label: "All", active: !step }, ...steps.map((s) => ({ href: href({ step: s.key, missing }), label: s.label, active: step === s.key }))]}
              />
              {(costs.totals.receiptsMissing > 0 || missing) && (
                <Link href={href({ step, missing: !missing })} aria-current={missing ? "true" : undefined} className={cn("text-xs", missing ? "font-semibold text-primary" : "text-text-2 hover:text-text")}>
                  Missing receipts ({costs.totals.receiptsMissing})
                </Link>
              )}
            </div>
          )}
          <ExpensesTable costs={costs} expenses={shown} setup={setup} />
        </div>
      </Section>

      {costs.toRepay.length > 0 && (
        <Section title="To repay" state={`${costs.toRepay.length} waiting`} tone="warn">
          <ul className="flex flex-col divide-y divide-line border-t border-line px-[18px]">
            {costs.toRepay.map((r) => (
              <li key={`${r.person.id}:${r.currency}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                <span className="min-w-0">
                  <span className="block font-semibold">{r.person.name} · own money</span>
                  <span className="block text-xs text-text-2">{r.items.map((i) => i.description).join(" · ")}</span>
                </span>
                <span className="flex items-center gap-2.5">
                  <span className="font-semibold tabular">{money(r.amount, r.currency)}</span>
                  {setup.canEdit && (
                    <RepayWindow orderId={o.id} ids={r.items.map((i) => i.id)} currency={r.currency} name={r.person.name} amount={money(r.amount, r.currency)} today={now} canFiles={d.canFiles} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p && (
        <Section
          title="Profit on this order"
          state={p.margin !== null ? `${p.margin.toFixed(1)}%` : null}
          tone={Number(p.expected) < 0 ? "bad" : "ok"}
          cols={3}
          actions={
            can(me, "ledger.view") && (
              <Link href={`/finance/ledger?view=orders&order=${o.id}`} className={buttonClass("ghost", "xs")}>
                Ledger entries
              </Link>
            )
          }
          rows={[
            { label: Number(p.uncosted) > 0 ? "Sale (lines with a cost)" : "Sale", value: money(p.sale, c) },
            { label: "Goods from the factory", value: `− ${money(p.factory, c)}` },
            { label: "Costs planned on the quotation", value: `− ${money(p.planned, c)}` },
            { label: "Costs not planned, so far", value: <span className={cn(over > 0 && "text-warn")}>− {money(p.notPlanned, c)}</span> },
            { label: "Bank charges on payments", value: `− ${money(p.bankCharges, c)}` },
            { label: PROFIT_LABEL.expected, value: <span className={cn(Number(p.expected) < 0 && "text-bad")}>{money(p.expected, c)}</span> },
            { label: PROFIT_LABEL.grossOnQuote, value: `${money(p.onQuote, c)}${p.onQuoteMargin !== null ? ` · ${p.onQuoteMargin.toFixed(1)}%` : ""}` },
            ...(Number(p.uncosted) > 0 ? [{ label: "Sale without a cost, left out", value: money(p.uncosted, c) }] : []),
            ...owed.filter((f) => f.toPay !== undefined).map((f) => ({ label: owed.length > 1 ? `Still to pay the factory, ${f.currency}` : "Still to pay the factory", value: `${money(f.toPay!, f.currency)} of ${money(f.amount, f.currency)}` })),
          ]}
        />
      )}

      {dealSpent.length > 0 && m && (
        <Section
          title="Spent before the order"
          state={`${dealSpent.length} expense${dealSpent.length === 1 ? "" : "s"}`}
          actions={
            <Link href={`/inquiries/${m.deal.id}`} className={buttonClass("ghost", "xs")}>
              Open the inquiry
            </Link>
          }
        >
          <ul className="flex flex-col divide-y divide-line border-t border-line px-[18px]">
            {dealSpent.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-2.5 text-[13px]">
                <span>{e.description}</span>
                <span className="text-text-2 tabular">{money(e.amount, e.currency)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </OrderPage>
  );
}
