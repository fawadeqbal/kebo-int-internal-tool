import Link from "next/link";
import { ORDER_TAB_LABEL } from "@kebo/shared";
import { Badge, buttonClass, cn, Notice, EmptyLine, RULES } from "@kebo/ui";
import { money, whole, dayMonth } from "@/lib/format";
import type { CostSheetRow } from "@/lib/types-money";
import { OrderPage } from "@/components/order-sections/order-side";
import { EmptySection, Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { ROW_LINK } from "@/components/order-sections/section-window";
import { PayCostWindow, RepayWindow } from "@/components/order-sections/costs-windows";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { AddCost, ChangeCost } from "@/components/money/cost-window";
import { costForOf, costKind } from "@/components/money/cost-kinds";
import { CostSheetTable, OwedBack, paidHow } from "@/components/orders/cost-sheet";
import { CostsExcel } from "@/components/orders/costs-tables";
import { costState } from "@/components/orders/cost-words";
import { stageData } from "../stage-data";
import { orderTitle } from "@/lib/titles";
import { RecordBox } from "@/components/common/record-box";

export const generateMetadata = orderTitle("Costs");

/** One of the four figures at the top. */
function Figure({
  label,
  value,
  sub,
  tone,
  first,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "bad";
  first?: boolean;
}) {
  return (
    <div className={cn(RULES.box.inset, "flex min-w-0 flex-col gap-0.5 py-3.5", !first && "border-line max-sm:border-t sm:border-l")}>
      <span className="text-xs text-text-2">{label}</span>
      <span
        className={cn(
          "text-lg font-bold tabular",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </span>
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
  const { costs, setup, canEdit, money: m } = data;
  const c = costs.currency;
  const sheet = costs.sheet;
  const byId = new Map(costs.expenses.map((e) => [e.id, e]));
  const known = sheet.rows.filter((r) => r.kind !== "estimate").length;
  const toPay = Number(sheet.toPay ?? 0);
  const dealSpent = (m?.dealExpenses ?? []).filter((e) => !e.voided);
  const beforeTotal = dealSpent.reduce((t, e) => t + Number(e.inMain), 0);
  // Paid from someone's own money and not paid back yet: per person and currency.
  const owed = costs.toRepay.map((r) => ({
    person: r.person,
    currency: r.currency,
    amount: r.amount,
    ids: r.items.map((x) => x.id),
    since: r.items.reduce((a, x) => (x.spentOn < a ? x.spentOn : a), r.items[0]?.spentOn ?? now),
  }));
  const fromHref: Partial<Record<CostSheetRow["from"], string>> = {
    factory: `${base}/factory`,
    shipment: `${base}/shipping`,
    payment: `${base}/payment`,
  };

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
          <Badge tone="info">Off the supplier</Badge>
        ) : r.kind === "goods" && r.state !== "paid" && r.state !== "estimate" ? (
          <Link href={`${base}/factory`} className={ROW_LINK}>
            {ORDER_TAB_LABEL.factory} →
          </Link>
        ) : r.state === "to_pay" && e && canEdit ? (
          <PayCostWindow
            orderId={o.id}
            id={e.id}
            currency={r.currency}
            sub={[r.owedTo, r.label, money(r.amount, r.currency)].filter(Boolean).join(" · ")}
            today={now}
            from={e.spentOn}
            canFiles={d.canFiles}
          />
        ) : r.state === "to_repay" && e && canEdit ? (
          <RepayWindow
            orderId={o.id}
            ids={[e.id]}
            currency={r.currency}
            name={e.paidBy?.name ?? "them"}
            amount={money(r.amount, r.currency)}
            today={now}
            canFiles={d.canFiles}
          />
        ) : (
          <Badge tone={r.state === "paid" ? "ok" : r.state === "estimate" ? "neutral" : "warn"}>{costState(r)}</Badge>
        )}
        {e && !follows && canEdit && !e.voided && <ChangeCost setup={setup} expense={e} iconOnly removeOrderId={o.id} />}
      </span>
    );
  };

  return (
    <OrderPage id={id}>
      {/* The four figures in a record box like every other part of the order. */}
      <RecordBox title="Profit on this order" what="the profit" canEdit={false}>
        <div className="grid min-w-0 sm:grid-cols-2 xl:grid-cols-4">
          <Figure
            first
            label="Order total"
            value={whole(o.total, o.currency)}
            sub={Number(o.money.due) <= 0 ? "received in full" : `${whole(o.money.received, o.currency)} received`}
          />
          {sheet.costs !== null && sheet.profit !== null ? (
            <>
              <Figure label="Costs so far" value={whole(sheet.costs, c)} sub={`${known} cost${known === 1 ? "" : "s"} known`} />
              <Figure
                label="Paid so far"
                value={whole(sheet.paid ?? 0, c)}
                sub={toPay > 0 ? `${whole(toPay, c)} still to pay` : "nothing waiting"}
                tone={toPay > 0 ? "warn" : undefined}
              />
              <Figure
                label="Profit now"
                value={whole(sheet.profit, c)}
                sub={sheet.margin !== null ? `${sheet.margin.toFixed(1)}% of the order` : "—"}
                tone={Number(sheet.profit) < 0 ? "bad" : "ok"}
              />
            </>
          ) : (
            <Figure label="Costs so far" value="—" sub={`no rate for ${costs.missingRate ?? c}`} />
          )}
        </div>
      </RecordBox>

      {costs.missingRate && (
        <Notice tone="todo">There is no exchange rate for {costs.missingRate} in Settings, so the costs cannot be added up in it.</Notice>
      )}

      <Section
        id="costs"
        title="Costs of this order"
        state={toPay > 0 ? `${whole(toPay, c)} to pay` : known > 0 ? "All paid" : null}
        tone={toPay > 0 ? "warn" : "ok"}
        actions={
          <>
            <CostsExcel costs={costs} />
            {canEdit && <AddCost setup={setup} />}
          </>
        }
        files={<SectionFiles orderId={o.id} section="expenses" canAdd={d.canFiles} />}
      >
        {sheet.rows.length === 0 ? (
          <EmptyLine className={cn(RULES.box.inset, "border-t border-line py-3.5")}>No cost known yet.</EmptyLine>
        ) : (
          <CostSheetTable
            rows={sheet.rows}
            currency={c}
            totals={sheet.costs !== null ? { costs: sheet.costs, paid: sheet.paid ?? "0", toPay: sheet.toPay ?? "0" } : null}
            action={action}
            receiptOf={(r) => (r.expenseId ? (byId.get(r.expenseId)?.receipt ?? null) : null)}
            howOf={(r) => {
              const e = r.expenseId ? byId.get(r.expenseId) : undefined;
              return e ? paidHow(e) : null;
            }}
            fromHref={fromHref}
          />
        )}
        {Number(sheet.uncosted) > 0 && (
          <p className={cn(RULES.box.inset, "border-t border-line py-2.5 text-xs text-text-2")}>
            {money(sheet.uncosted, c)} of the order is on items without a cost: left out of the profit.
          </p>
        )}
      </Section>

      {dealSpent.length > 0 && m && (
        <Section
          title="Spent on its inquiry before the order"
          state={`${dealSpent.length} cost${dealSpent.length === 1 ? "" : "s"} · ${money(beforeTotal, setup.mainCurrency)}`}
          actions={
            <Link href={`/inquiries/${m.deal.id}/costs`} className={buttonClass("ghost", "xs")}>
              Open the inquiry
            </Link>
          }
        >
          <p className={cn(RULES.box.inset, "border-t border-line pt-2.5 text-xs text-text-2")}>
            {dealSpent[0]?.deal ? `From ${dealSpent[0].deal.refNo}. ` : ""}Not in Profit now, which stays the number the Orders list and
            Reports use. It counts on {o.customer.name} after all costs.
          </p>
          <ul className={cn(RULES.box.inset, "flex flex-col divide-y divide-line")}>
            {dealSpent.map((e) => {
              const how = [e.paidBy?.name, paidHow(e)].filter(Boolean).join(" · ");
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-md">
                  <span className="w-14 shrink-0 text-text-2 tabular">{dayMonth(e.spentOn)}</span>
                  <span className="min-w-0 flex-1">
                    {e.description} <Badge tone="neutral">{costKind(e.category)}</Badge>
                    {how && <span className="block text-xs text-text-2">{how}</span>}
                  </span>
                  <span className="text-text-2 tabular">{money(e.amount, e.currency)}</span>
                  {canEdit && <ChangeCost setup={{ ...setup, for: costForOf(e), order: undefined }} expense={e} iconOnly />}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <OwedBack owed={owed} where="on this order" orderId={o.id} today={now} canPay={canEdit} canFiles={d.canFiles} />
    </OrderPage>
  );
}
