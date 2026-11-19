import Link from "next/link";
import { Card, CardHeader, cn, Td, Th, THead, Tr, EmptyLine } from "@kebo/ui";
import { DataTable } from "@/components/common/data-table";
import { date, money } from "@/lib/format";
import type { CustomerAccount, ExpenseList } from "@/lib/types-money";
import { costForOf, costKind } from "./cost-kinds";
import { AddCost, ChangeCost, type CostSetup } from "./cost-window";

/*
 * A customer's Money tab, the parts about spending (design "spending", board CustomerMoney), for managers with
 * expenses: where their money went, and every cost spent on them. The figures and the Statement stay as they are.
 */

/**
 * "Where their money went" (design "spending", board CustomerMoney): what they bought, less the orders' own costs, is
 * the profit on their orders (as on each order and in Reports); less what was spent outside the orders is the
 * profit after all costs. All in the main currency, each cost at its own rate.
 */
export function WhereMoneyWent({ a }: { a: CustomerAccount }) {
  const c = a.currency;
  const t = a.totals;
  const sales = Number(t.sales);
  const orders = a.rows.filter((r) => r.order).length;
  const pct = (v: number) => (sales > 0 ? ` · ${((v / sales) * 100).toFixed(1)}%` : "");
  const lines: { label: string; value: number; strong?: boolean; sub?: boolean }[] = [
    { label: `Sold, ${orders} order${orders === 1 ? "" : "s"}`, value: sales },
    { label: "Goods, shipping and the orders' own costs", value: -(sales - Number(t.uncostedRevenue) - Number(t.profit)), sub: true },
    { label: "Sold on items with no cost yet (left out of profit)", value: -Number(t.uncostedRevenue), sub: true },
    { label: "Profit on their orders (as on each order)", value: Number(t.profit), strong: true },
    { label: "Before the orders, on the inquiries we won", value: -Number(t.beforeSale), sub: true },
    { label: `On ${a.deals.lost} inquir${a.deals.lost === 1 ? "y" : "ies"} they did not buy`, value: -Number(t.lostDeals), sub: true },
    { label: "On inquiries still open", value: -Number(t.openDeals), sub: true },
    { label: "Visits, gifts and samples on them", value: -Number(t.otherCosts), sub: true },
  ].filter((l) => !l.sub || l.value !== 0 || l.label.startsWith("Goods"));
  const net = Number(t.net);
  const parts = [
    ["trips and checks on their orders", t.orderCosts],
    ["before the orders", t.beforeSale],
    ["inquiries not bought", t.lostDeals],
    ["inquiries still open", t.openDeals],
    ["visits, gifts, samples", t.otherCosts],
  ].filter(([, v]) => Number(v) > 0);
  return (
    <section id="where" aria-label="Where their money went" className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <CardHeader title="Where their money went" description={`In ${c}, each cost at its own rate`} />
      <dl className="flex flex-col px-4 py-2 text-md">
        {lines.map((l) => (
          <div key={l.label} className={cn("flex justify-between gap-3 py-1.5", l.strong && "border-t border-line font-semibold")}>
            <dt className={l.sub ? "text-text-2" : undefined}>{l.label}</dt>
            <dd className="tabular">
              {l.value < 0 ? `− ${money(-l.value, c)}` : money(l.value, c)}
              {l.strong && <span className="font-normal text-text-2">{pct(l.value)}</span>}
            </dd>
          </div>
        ))}
        <div className={cn("flex justify-between gap-3 border-t-2 border-line-strong py-2 font-bold", net < 0 ? "text-bad" : "text-ok")}>
          <dt>Profit after all costs</dt>
          <dd className="tabular">
            {money(net, c)}
            <span className="font-normal">{pct(net)}</span>
          </dd>
        </div>
      </dl>
      <p className="border-t border-line px-4 py-2.5 text-xs text-text-2">
        Spent on them: <strong className="text-text">{money(t.spent, c)}</strong>
        {parts.length > 0 && ` — ${parts.map(([l, v]) => `${l} ${money(v, c)}`).join(" · ")}`}. The orders&apos; profit is the same number as on each order and in
        Reports; only the costs outside the orders are taken off here.
      </p>
    </section>
  );
}

/**
 * "Spending on this customer": every cost on them, their inquiries and their orders, newest first, each opening
 * the cost window; Add a cost for them.
 */
export function CustomerSpending({
  list,
  setup,
  customerId,
  shown = 12,
}: {
  list: ExpenseList;
  setup: CostSetup;
  customerId: string;
  shown?: number;
}) {
  const c = list.currency;
  const rows = list.rows.filter((e) => !e.voided);
  const first = rows.slice(0, shown);
  const total = rows.reduce((t, e) => t + Number(e.inMain), 0);
  return (
    <Card className="overflow-clip">
      <CardHeader
        title={
          <span>
            Spending on this customer{" "}
            {rows.length > 0 && (
              <span className="text-xs font-normal text-muted">
                · {rows.length} cost{rows.length === 1 ? "" : "s"} · {money(total, c)}
              </span>
            )}
          </span>
        }
        actions={<AddCost setup={setup} label="Add a cost for them" variant="secondary" />}
      />
      {first.length === 0 ? (
        <EmptyLine className="border-t border-line px-[18px] py-3.5">Nothing spent on this customer yet.</EmptyLine>
      ) : (
        <DataTable label="Spending on this customer" tableClassName="text-md">
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>What for</Th>
              <Th>For</Th>
              <Th>Who paid</Th>
              <Th className="text-right">Amount {c}</Th>
              <Th>
                <span className="sr-only">Change</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {first.map((e) => (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap text-text-2">{date(e.spentOn)}</Td>
                <Td>
                  {e.description}
                  <span className="block text-xs text-text-2">{costKind(e.category)}</span>
                </Td>
                <Td>
                  {e.order ? (
                    <Link href={`/orders/${e.order.id}/costs`} className="font-medium hover:text-primary hover:underline">
                      {e.order.refNo}
                    </Link>
                  ) : e.deal ? (
                    <>
                      <Link href={`/inquiries/${e.deal.id}/costs`} className="font-medium hover:text-primary hover:underline">
                        {e.deal.refNo}
                      </Link>
                      {e.deal.stage === "lost" && <span className="text-text-2"> lost</span>}
                    </>
                  ) : (
                    <span className="text-text-2">The customer</span>
                  )}
                </Td>
                <Td className="text-text-2">
                  {e.paidBy?.name ?? "Not said"}
                  {e.ownMoney && <span className={cn("block text-xs", !e.repaid && "text-warn")}>{e.repaid ? "own money · paid back" : "own money · owed back"}</span>}
                </Td>
                <Td className="text-right whitespace-nowrap tabular">
                  {money(e.inMain, c)}
                  {e.currency !== c && <span className="block text-xs text-text-2">{money(e.amount, e.currency)}</span>}
                </Td>
                <Td className="text-right">
                  <ChangeCost setup={{ ...setup, for: costForOf(e) }} expense={e} iconOnly removeOrderId={e.orderId} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {rows.length > first.length && (
        <p className="border-t border-line px-[18px] py-2.5 text-md">
          <Link href={`/payments?party=${customerId}&kind=expense`} className="font-medium text-primary hover:underline">
            All {rows.length} costs in Payments →
          </Link>
        </p>
      )}
    </Card>
  );
}
