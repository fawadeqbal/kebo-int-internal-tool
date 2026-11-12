import { ArrowUpRight } from "lucide-react";
import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { orderMoneyOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { api } from "@/lib/api";
import { PurchaseOrderCard, type PurchaseOrderView } from "@/components/orders/purchase-order-card";
import { sendPurchaseOrderAction } from "../../flow-actions";
import { OrderLines, PhoneLines } from "@/components/orders/order-lines";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { StepPage, StepViewDivider } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { DetailsCard, LinesCard, type DetailField } from "@/components/orders/step-view";
import { expensePayTools } from "@/components/orders/costs-card";
import { RecordPaymentLink } from "@/components/money/pay-links";
import { FactoryPlanCard } from "@/components/money/money-v2";
import { factoryPlanAction } from "../../../money/actions";
import { fieldsAction, lightAction } from "../../light-actions";
import { FactoriesView } from "../money-cards";
import { MoneySection } from "../money-sections";
import { stepData } from "../step-data";

export const metadata = { title: "Order · factory order" };

/**
 * Step 2, Factory order: the checklist (ordered, advance paid), then the view:
 * the factory and their order no., the lines at factory prices and what we pay
 * each factory (people who see factory money), the papers and the costs.
 */
export default async function OrderFactory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "factory");
  const { me, o, flow, now, defaults } = d;
  const [m, pos] = await Promise.all([
    orderMoneyOf(id),
    api.get<{ deposit: { asked: string; paid: string; verified: boolean }; items: PurchaseOrderView[] }>(`/orders/${id}/purchase-orders`).catch(() => null),
  ]);
  const canEdit = can(me, "orders.update") && d.open;
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  // Money out is recorded on Treasury › Payments (one form); here it is a link, with the plan's part filled in.
  const payFactory = (label: string, quiet = true, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance" }) =>
    m.factories?.canRecord && owing.length && d.open ? (
      <RecordPaymentLink
        kind="out"
        order={o.id}
        factory={prefill?.factoryId}
        amount={prefill?.amount}
        part={prefill?.kind}
        back={`/orders/${o.id}/factory`}
        label={label}
        quiet={quiet}
      />
    ) : null;

  const factories = flow?.factory.factories ?? [];
  const names = factories.map((f) => f.name).join(", ");
  const orderedOn = flow?.factory.orderedOn ?? null;
  const orderNo = flow?.factory.orderNo ?? null;
  const readyBy = (flow?.factory.readyBy ?? []).filter((r) => r.factoryId);

  const tools: Record<string, AutoTool> = {};
  if (canEdit)
    tools.factory_ordered = {
      kind: "light",
      label: "Add their order no.",
      action: lightAction.bind(null, o.id, "ordered"),
      fields: [
        { name: "factoryOrderNo", label: "Their order no.", value: orderNo, required: true, placeholder: "e.g. HP-2026-118" },
        { name: "factoryOrderedOn", label: "Ordered on", type: "date", value: orderedOn ?? now, max: now, required: true },
      ],
      chips: [
        { label: "Their PI or our PO", field: { name: "attachmentId", label: "Their PI or our PO (copy)", type: "file" } },
        { label: "Note", field: { name: "itemNote", label: "Note", type: "textarea" } },
      ],
      hint: names ? `${names}, at the prices of the quote.` : "The factory and prices come from the quote.",
      tap: orderedOn ? undefined : { label: "Ordered today", action: lightAction.bind(null, o.id, "ordered"), on: now },
    };
  // The advance: the factory payment form filled in with the plan's part due when we order.
  const advancePart = m.factories?.plans.find((p) => p.rows.some((r) => r.dueRule === "on_order" && r.status !== "paid")) ?? null;
  const advanceRow = advancePart?.rows.find((r) => r.dueRule === "on_order" && r.status !== "paid");
  const advance = payFactory(
    "Pay the factory",
    true,
    advancePart && advanceRow ? { factoryId: advancePart.factory.id, amount: advanceRow.open, kind: "deposit" } : undefined,
  );
  if (advance) tools.factory_advance = { kind: "node", node: advance };

  // Factory prices come only to people who see them.
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const priced = goodsLines.some((l) => l.factoryPrice) ? goodsLines : [];
  const basis = defaults.priceBasis ? `${defaults.priceBasis.basis}${defaults.priceBasis.place ? ` ${defaults.priceBasis.place}` : ""}` : null;
  const fields: DetailField[] = [
    { label: factories.length > 1 ? "Factories" : "Factory", value: names || null },
    { name: "factoryOrderNo", label: "Their order no.", value: orderNo, group: "The order with the factory" },
    { name: "factoryOrderedOn", label: "Ordered on", value: orderedOn, type: "date", max: now, group: "The order with the factory" },
    ...(can(me, "sourcing.manage") ? [{ label: "Price basis", value: basis, uncounted: !basis }] : []),
    // One ready date per factory (each factory's PO, plan and production read its own); the order's is the latest.
    ...(readyBy.length > 1
      ? [
          ...readyBy.map((r) => ({
            name: `readyOn__${r.factoryId}`,
            label: `Ready · ${r.name ?? "factory"}`,
            value: r.readyOn,
            type: "date" as const,
            group: "Ready date, each factory's",
            hint: defaults.leadTime ? `Lead time on the quote: ${defaults.leadTime.text}` : undefined,
          })),
          {
            label: "Order ready (the latest)",
            value: flow?.factory.readyOn ? date(flow.factory.readyOn) : null,
            uncounted: true,
            cardOnly: true,
            group: "Ready date, each factory's",
          },
        ]
      : [
          {
            name: "readyOn",
            label: "Ready (factory says)",
            value: o.readyOn,
            type: "date" as const,
            group: "Ready date",
            hint: defaults.leadTime ? `Lead time on the quote: ${defaults.leadTime.text}` : undefined,
          },
        ]),
  ];

  return (
    <StepPage
      steps={d.steps}
      step="factory"
      base={d.base}
      action={payFactory("Pay the factory", false)}
      side={<StepSidePanel id={o.id} step="factory" changes={d.changes} historyHref={d.historyHref} />}
    >
      {/* The purchase orders (board OrderFactory): one per supplier, numbered, sent with a reason before the deposit. */}
      {pos?.items.map((po) => (
        <PurchaseOrderCard
          key={po.id}
          po={po}
          total={po.total && po.currency ? money(po.total, po.currency) : null}
          ready={po.readyOn ? date(po.readyOn) : null}
          sent={po.sentOn ? date(po.sentOn) : null}
          printHref={`/orders/${o.id}/papers/purchase-order?ref=${po.supplier.id}`}
          send={canEdit && !po.sentOn ? sendPurchaseOrderAction.bind(null, o.id, po.id) : null}
          deposit={{
            verified: pos.deposit.verified,
            text: Number(pos.deposit.paid) > 0
              ? `${money(pos.deposit.paid, o.currency)} of the deposit ${money(pos.deposit.asked, o.currency)} is recorded; the rest is not in yet.`
              : `The deposit ${money(pos.deposit.asked, o.currency)} is not recorded yet.`,
          }}
          today={now}
        />
      ))}
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="factory"
        label="Factory order"
        items={d.items}
        current={d.current}
        canEdit={d.steps.canEdit}
        run={d.run}
        dealId={o.inquiry.id}
        people={d.people}
        tools={tools}
        payNode={payFactory("Pay")}
        listHref={d.listHref}
        me={me.name}
        today={now}
      />
      <StepViewDivider />
      <DetailsCard
        target="factory"
        title="Factory"
        fields={fields.map((f) => (f.type === "date" && f.value ? { ...f, show: date(f.value) } : f))}
        action={fieldsAction.bind(null, o.id, "factory")}
        canEdit={canEdit}
        panelTitle="Edit the factory order"
        panelDescription="Their number, the day we ordered and the ready date they gave. Saving updates the checklist."
      />
      {priced.length > 0 && (
        <LinesCard
          target="lines.factory"
          title="Lines · to the factory"
          description="What we bought from the factory for each line, at its price (internal)."
          canEdit={false}
          view={<OrderLines set="factory" orderId={o.id} lines={priced} canEdit={false} today={now} />}
          phone={<PhoneLines set="factory" lines={priced} />}
        />
      )}
      {m.factories?.plans.map((plan) => {
        const next = plan.rows.find((r) => r.status !== "paid");
        const paidInOrder = m.factories!.payments
          .filter((x) => !x.voided && x.factory.id === plan.factory.id && x.currency === plan.currency)
          .reduce((t, x) => t + Number(x.inOrderCurrency), 0);
        return (
          <Card key={`${plan.factory.id}:${plan.currency}`} id={`plan-${plan.factory.id}`} data-target="factory.plan" data-target-card="">
            <CardHeader
              title={`What we pay ${plan.factory.name} · ${o.refNo}`}
              description={`Agreed once per factory on the order: an advance when we order, the balance on ${plan.factory.name}'s ready date${plan.readyOn ? ` (${date(plan.readyOn)})` : ""} (or on a fixed day).`}
            />
            <CardBody>
              <FactoryPlanCard
                plan={plan}
                action={factoryPlanAction.bind(null, o.id)}
                canPlan={!!m.factories?.canPlan && d.open}
                orderCurrency={o.currency}
                paidInOrder={paidInOrder ? paidInOrder.toFixed(2) : null}
                pay={
                  next && Number(next.open) > 0
                    ? payFactory(`Pay ${next.label.toLowerCase()}`, true, {
                        factoryId: plan.factory.id,
                        amount: next.open,
                        kind: next.dueRule === "on_order" ? "deposit" : "balance",
                      })
                    : null
                }
              />
            </CardBody>
          </Card>
        );
      })}
      {m.factories && (
        <MoneySection
          id="factory-money"
          target="factory.payments"
          icon={<ArrowUpRight aria-hidden />}
          title="To the factory"
          tag="Internal"
          sub={factories.length ? `We pay ${names} for the goods` : "What we owe the factories for this order"}
        >
          <FactoriesView m={m} pay={payFactory("Record payment")} />
        </MoneySection>
      )}
    </StepPage>
  );
}
