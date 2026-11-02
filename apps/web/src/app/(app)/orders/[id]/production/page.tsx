import { can } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { orderMoneyOf } from "@/lib/order-data";
import { date } from "@/lib/format";
import type { Person } from "@/lib/types";
import { optional } from "@/components/print/data";
import { Checklist, type AutoTool } from "@/components/orders/checklist";
import { KeyFacts, StepChanges, StepFiles, StepPage } from "@/components/orders/step-page";
import { expensePayTools, StepCosts } from "@/components/orders/costs-card";
import { NewFactoryPayment } from "@/components/money/forms";
import { factoryPaymentAction } from "../../../money/actions";
import { receiptAction } from "../../actions";
import { readyDateAction } from "../../checklist-actions";
import { GoodsExcel, GoodsReceipt } from "../goods";
import { goodsOf } from "../shared";
import { stepData } from "../step-data";

export const metadata = { title: "Order · production" };

const DAY = 86_400_000;

/** Step 3, Production: the factory's milestones (the checklist), the ready date, paying the factory in full, and the goods as they come in. */
export default async function OrderProduction({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "production");
  const { me, o, flow, now } = d;
  const canEdit = can(me, "orders.update") && d.open;
  const [m, people, settings] = await Promise.all([
    optional(() => orderMoneyOf(id)),
    optional(() => api.get<Person[]>("/users/people")),
    optional(() => api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings")),
  ]);
  const owing = m?.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  const payFactory = (label: string) =>
    m?.factories?.canRecord && owing.length && d.open && settings ? (
      <NewFactoryPayment
        quiet
        label={label}
        action={factoryPaymentAction.bind(null, m.orderId, null)}
        factories={owing}
        people={people ?? []}
        orderCurrency={o.currency}
        fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
        today={now}
      />
    ) : null;
  const goods = goodsOf(o);

  const tools: Record<string, AutoTool> = {};
  if (canEdit)
    tools.ready_date = {
      kind: "date",
      label: "Set the date",
      action: readyDateAction.bind(null, o.id),
      name: "readyOn",
      field: "Ready on (the factory says)",
      value: o.readyOn,
      save: "Save the date",
    };
  if (goods.length) tools.goods_received = { kind: "link", label: canEdit ? "Record goods" : "See the goods", href: "#goods" };
  const balance = payFactory("Pay the factory");
  if (balance) tools.factory_paid = { kind: "node", node: balance };

  const left = o.readyOn ? Math.round((Date.parse(`${o.readyOn}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / DAY) : null;
  const factories = flow?.factory.factories ?? [];
  return (
    <StepPage
      steps={d.steps}
      step="production"
      base={d.base}
      side={
        <>
          <KeyFacts
            editHref={canEdit ? `${d.base}#details` : undefined}
            facts={[
              { label: factories.length > 1 ? "Factories" : "Factory", value: factories.map((f) => f.name).join(", ") || null },
              { label: "Ordered", value: flow?.factory.orderedOn ? date(flow.factory.orderedOn) : "Not yet" },
              { label: "Ready", value: o.readyOn ? date(o.readyOn) : "Not known yet" },
              {
                label: "Days left",
                value: left === null ? null : left < 0 ? <span className="text-bad">{-left} late</span> : String(left),
              },
              { label: "Ship by", value: o.shipBy ? date(o.shipBy) : null },
              { label: "Goods in", value: goods.length ? `${o.goods.received} of ${o.goods.lines}` : "No goods lines" },
            ]}
          />
          <StepCosts id={o.id} step="production" />
          <StepFiles items={d.items} addHref={d.steps.canEdit ? `${d.base}/documents#files` : undefined} />
          <StepChanges entries={d.changes} historyHref={d.historyHref} />
        </>
      }
    >
      <Checklist
        payFor={await expensePayTools(o.id, d.items)}
        step="production"
        label="Production"
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
      {goods.length > 0 && (
        <Card id="goods" className="scroll-mt-24">
          <CardHeader
            title="Goods from the factory"
            description={
              o.goods.allReceived
                ? "Everything has come in."
                : `${o.goods.received} of ${o.goods.lines} item${o.goods.lines === 1 ? "" : "s"} complete. Record what comes in as it arrives.`
            }
            actions={
              <>
                {o.goods.allReceived && <Badge tone="ok">All in</Badge>}
                <GoodsExcel lines={goods} />
              </>
            }
          />
          <CardBody>
            <GoodsReceipt
              key={goods.map((l) => l.receivedQty).join()}
              lines={goods}
              canEdit={canEdit}
              action={receiptAction.bind(null, o.id)}
              today={now}
            />
          </CardBody>
        </Card>
      )}
    </StepPage>
  );
}
