import Link from "next/link";
import { expenseShort, ORDER_TAB_LABEL } from "@kebo/shared";
import { Alert, Badge, buttonClass, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { money, whole } from "@/lib/format";
import type { CostSheetRow } from "@/lib/types-money";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { PayCostWindow, RepayWindow } from "@/components/order-sections/costs-windows";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { AddOrderExpense, EditOrderExpense } from "@/components/orders/expense-form";
import { CostsExcel } from "@/components/orders/costs-tables";
import { COST_FROM, costState } from "@/components/orders/cost-words";
import { stageData } from "../stage-data";

export const metadata = { title: "Order · costs" };

const n2 = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
 * Costs (design "money, simple", board OCost; managers with the expenses feature): the order's cost sheet.
 * Four figures (order total, costs so far, paid so far, profit now) and one list of every cost: the goods
 * from the factory order, freight and insurance from the shipment, bank charges from the payments, and the
 * costs added here. A cost counts as soon as it is known and is marked paid when it is paid.
 */
export default async function OrderCostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stageData(id);
  const { o, base, now } = d;
  const data = await orderCostsSetup(id);
  if (!data)
    return (
      <OrderPage id={id}>
        <EmptySection title="Costs" text="Only managers with expenses switched on for the company see an order’s costs and profit." />
      </OrderPage>
    );
  const { costs, setup, money: m } = data;
  const c = costs.currency;
  const sheet = costs.sheet;
  const byId = new Map(costs.expenses.map((e) => [e.id, e]));
  const known = sheet.rows.filter((r) => r.kind !== "estimate").length;
  const toPay = Number(sheet.toPay ?? 0);
  const dealSpent = (m?.dealExpenses ?? []).filter((e) => !e.voided);
  const fromHref: Partial<Record<CostSheetRow["from"], string>> = { factory: `${base}/factory`, shipment: `${base}/shipping`, payment: `${base}/payment` };

  /** What can be done on a row: pay or repay what waits, open where it comes from, or change a cost added here. */
  const action = (r: CostSheetRow) => {
    const e = r.expenseId ? byId.get(r.expenseId) : undefined;
    // A cost that follows its shipment is changed there until it is paid.
    const follows = r.from === "shipment" && r.state !== "paid";
    return (
      <span className="flex items-center justify-end gap-2">
        {r.borneBy === "customer" ? (
          <Badge tone="info">The customer pays</Badge>
        ) : r.borneBy === "factory" ? (
          <Badge tone="info">Off the factory</Badge>
        ) : r.kind === "goods" && r.state !== "paid" && r.state !== "estimate" ? (
          <Link href={`${base}/factory`} className={ROW_LINK}>
            {ORDER_TAB_LABEL.factory} →
          </Link>
        ) : r.state === "to_pay" && e && setup.canEdit ? (
          <PayCostWindow orderId={o.id} id={e.id} currency={r.currency} sub={[r.owedTo, r.label, money(r.amount, r.currency)].filter(Boolean).join(" · ")} today={now} from={e.spentOn} canFiles={d.canFiles} />
        ) : r.state === "to_repay" && e && setup.canEdit ? (
          <RepayWindow orderId={o.id} ids={[e.id]} currency={r.currency} name={e.paidBy?.name ?? "them"} amount={money(r.amount, r.currency)} today={now} canFiles={d.canFiles} />
        ) : (
          <Badge tone={r.state === "paid" ? "ok" : r.state === "estimate" ? "neutral" : "warn"}>{costState(r)}</Badge>
        )}
        {e && !follows && <EditOrderExpense setup={setup} expense={e} />}
      </span>
    );
  };

  return (
    <OrderPage id={id}>
      <section aria-label="Costs at a glance" className="grid min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card sm:grid-cols-2 xl:grid-cols-4">
        <Figure first label="Order total" value={whole(o.total, o.currency)} sub={Number(o.money.due) <= 0 ? "received in full" : `${whole(o.money.received, o.currency)} received`} />
        {sheet.costs !== null && sheet.profit !== null ? (
          <>
            <Figure label="Costs so far" value={whole(sheet.costs, c)} sub={`${known} cost${known === 1 ? "" : "s"} known`} />
            <Figure label="Paid so far" value={whole(sheet.paid ?? 0, c)} sub={toPay > 0 ? `${whole(toPay, c)} still to pay` : "nothing waiting"} tone={toPay > 0 ? "warn" : undefined} />
            <Figure label="Profit now" value={whole(sheet.profit, c)} sub={sheet.margin !== null ? `${sheet.margin.toFixed(1)}% of the order` : "—"} tone={Number(sheet.profit) < 0 ? "bad" : "ok"} />
          </>
        ) : (
          <Figure label="Costs so far" value="—" sub={`no rate for ${costs.missingRate ?? c}`} />
        )}
      </section>

      {costs.missingRate && <Alert tone="warning">There is no exchange rate for {costs.missingRate} in Settings, so the costs cannot be added up in it.</Alert>}

      <Section
        id="costs"
        title="Costs of this order"
        state={toPay > 0 ? `${whole(toPay, c)} to pay` : known > 0 ? "All paid" : null}
        tone={toPay > 0 ? "warn" : "ok"}
        actions={
          <>
            <CostsExcel costs={costs} />
            <AddOrderExpense setup={setup} step={null} label="Add a cost" />
          </>
        }
        files={<SectionFiles orderId={o.id} section="expenses" canAdd={d.canFiles} />}
      >
        {sheet.rows.length === 0 ? (
          <p className="border-t border-line px-[18px] py-3.5 text-[13px] text-text-2">No cost known yet.</p>
        ) : (
          <Table className="min-w-[640px]">
            <THead>
              <tr>
                <Th>What for</Th>
                <Th>Who we owe</Th>
                <Th>Comes from</Th>
                <Th className="text-right">Cost {c}</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">Still to pay</Th>
                <Th>
                  <span className="sr-only">Pay or change</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {sheet.rows.map((r) => {
                const ours = r.borneBy === "us";
                const e = r.expenseId ? byId.get(r.expenseId) : undefined;
                const kind = r.kind === "goods" ? "Goods from the factory" : r.kind === "estimate" ? "Estimated on the quotation" : r.category && r.kind === "cost" ? expenseShort(r.category) : r.label;
                const detail = r.kind === "cost" && r.label !== kind ? r.label : r.kind === "estimate" ? r.label : null;
                return (
                  <Tr key={r.key} className={r.kind === "estimate" || !ours ? "text-text-2" : undefined}>
                    <Td>
                      <span className="font-semibold">{kind}</span>
                      {detail && <span className="block text-xs text-text-2">{detail}</span>}
                      {e?.receipt && (
                        <a href={`/files/${e.receipt.id}?view=1`} target="_blank" rel="noreferrer" className="block text-xs text-primary hover:underline">
                          Their bill
                        </a>
                      )}
                    </Td>
                    <Td>{r.owedTo ?? dash}</Td>
                    <Td className="text-text-2">
                      {fromHref[r.from] ? (
                        <Link href={fromHref[r.from]!} className="hover:text-primary hover:underline">
                          {COST_FROM[r.from]}
                        </Link>
                      ) : (
                        COST_FROM[r.from]
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {r.inOrder !== null ? n2(r.inOrder) : dash}
                      {(r.currency !== c || r.inOrder === null) && <span className="block text-xs text-text-2">{money(r.amount, r.currency)}</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{r.paidInOrder !== null && r.kind !== "estimate" ? n2(r.paidInOrder) : dash}</Td>
                    <Td className={cn("text-right whitespace-nowrap tabular", Number(r.toPayInOrder ?? 0) > 0 && "font-semibold text-warn")}>{r.toPayInOrder !== null && r.kind !== "estimate" ? n2(r.toPayInOrder) : dash}</Td>
                    <Td className="text-right">{action(r)}</Td>
                  </Tr>
                );
              })}
            </tbody>
            {sheet.costs !== null && (
              <tfoot>
                <tr className="border-t-2 border-line-strong font-bold">
                  <td className="px-3.5 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3.5 py-3 text-right tabular">{n2(sheet.costs)}</td>
                  <td className="px-3.5 py-3 text-right tabular">{n2(sheet.paid ?? 0)}</td>
                  <td className={cn("px-3.5 py-3 text-right tabular", toPay > 0 && "text-warn")}>{n2(sheet.toPay ?? 0)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </Table>
        )}
        {Number(sheet.uncosted) > 0 && (
          <p className="border-t border-line px-[18px] py-2.5 text-xs text-text-2">{money(sheet.uncosted, c)} of the order is on lines without a cost: left out of the profit.</p>
        )}
      </Section>

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
