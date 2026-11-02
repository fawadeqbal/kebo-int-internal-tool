import { ArrowUpRight } from "lucide-react";
import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { orderMoneyOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import { FactoryOrderPanel } from "@/components/orders/flow-panels";
import { OrderLines } from "@/components/orders/order-lines";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { NewFactoryPayment } from "@/components/money/forms";
import { FactoryPlanCard } from "@/components/money/money-v2";
import { factoryPaymentAction, factoryPlanAction } from "../../../money/actions";
import { factoryOrderAction } from "../../flow-actions";
import { FactoriesView } from "../money-cards";
import { MoneySection } from "../money-sections";
import { stepData } from "../step-data";

export const metadata = { title: "Order · factory order" };

/** Step 2, Factory order: the day we ordered from the factory, and what we owe and paid each factory (people who see factory money). */
export default async function OrderFactory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "factory");
  const { me, o, flow, now } = d;
  const [m, people, settings] = await Promise.all([
    orderMoneyOf(id),
    api.get<Person[]>("/users/people"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const canEdit = can(me, "orders.update") && d.open;
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  const payFactory = (label: string, quiet = true, prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance" }) =>
    m.factories?.canRecord && owing.length && d.open ? (
      <NewFactoryPayment
        quiet={quiet}
        label={label}
        prefill={prefill}
        action={factoryPaymentAction.bind(null, m.orderId, null)}
        factories={owing}
        people={people}
        orderCurrency={o.currency}
        fx={fx}
        today={now}
      />
    ) : null;

  const tools: Record<string, AutoTool> = {};
  if (canEdit)
    tools.factory_ordered = {
      kind: "date",
      label: "Mark as ordered",
      action: factoryOrderAction.bind(null, o.id),
      name: "factoryOrderedOn",
      field: "Ordered from the factory on",
      value: flow?.factory.orderedOn ?? null,
      max: now,
      save: "Save",
      hint: "The day we confirmed the order (PO or signed proforma)",
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

  const factories = flow?.factory.factories ?? [];
  // Factory prices come only to people who see them.
  const goodsLines = o.lines.filter((l) => l.type === "goods");
  const priced = goodsLines.some((l) => l.factoryPrice) ? goodsLines : [];
  const owed = m.factories?.rows ?? [];
  return (
    <StepPage
      steps={d.steps}
      step="factory"
      base={d.base}
      action={payFactory("Pay the factory", false)}
      side={
        <>
          <KeyFacts
            facts={[
              { label: factories.length > 1 ? "Factories" : "Factory", value: factories.map((f) => f.name).join(", ") || null },
              { label: "Ordered on", value: flow?.factory.orderedOn ? date(flow.factory.orderedOn) : "Not yet" },
              { label: "Ready", value: o.readyOn ? date(o.readyOn) : "Not known yet" },
              ...owed.map((r) => ({
                label: owed.length > 1 ? `Paid ${r.factory.name}` : "Paid",
                value: `${money(r.paid, r.currency)} of ${money(r.owed, r.currency)}`,
              })),
            ]}
          />
          <StepCosts id={o.id} step="factory" />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? `${d.base}/documents#files` : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
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
      />
      {flow && (
        <Card>
          <CardHeader title="Order with the factory" description="The factory, the day we ordered, and the ready date they gave." />
          <CardBody>
            <FactoryOrderPanel
              action={factoryOrderAction.bind(null, o.id)}
              orderedOn={flow.factory.orderedOn}
              readyOn={flow.factory.readyOn}
              factories={factories}
              today={now}
              canEdit={canEdit}
            />
          </CardBody>
        </Card>
      )}
      {priced.length > 0 && (
        <Card>
          <CardHeader title="Lines · to the factory" description="What we bought from the factory for each line, at its price (internal)." />
          <CardBody>
            <OrderLines set="factory" orderId={o.id} lines={priced} canEdit={false} today={now} />
          </CardBody>
        </Card>
      )}
      {m.factories?.plans.map((plan) => {
        const next = plan.rows.find((r) => r.status !== "paid");
        const paidInOrder = m.factories!.payments
          .filter((x) => !x.voided && x.factory.id === plan.factory.id && x.currency === plan.currency)
          .reduce((t, x) => t + Number(x.inOrderCurrency), 0);
        return (
          <Card key={`${plan.factory.id}:${plan.currency}`} id={`plan-${plan.factory.id}`}>
            <CardHeader
              title={`What we pay ${plan.factory.name} · ${o.refNo}`}
              description="Agreed once per factory on the order: an advance when we order, the balance when they say ready (or on a fixed day)."
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
          icon={<ArrowUpRight aria-hidden />}
          title="To the factory"
          tag="Internal"
          sub={
            factories.length
              ? `We pay ${factories.map((f) => f.name).join(", ")} for the goods`
              : "What we owe the factories for this order"
          }
        >
          <FactoriesView m={m} people={people} today={now} fx={fx} />
        </MoneySection>
      )}
    </StepPage>
  );
}
