import { can, FLOW_STEP_LABEL, FLOW_STEPS, type FlowStep } from "@kebo/shared";
import { Card, CardBody, CardHeader, Segmented } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderHistoryOf, orderMoneyOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { today } from "@/components/orders/today";
import { HistoryList } from "@/components/common/history-list";
import { optional } from "@/components/print/data";
import { cancelOrderAction } from "../../actions";
import { CancelOrderForm } from "../forms";

export const metadata = { title: "Order history" };

/** Every change to the order with its reason, or one step's; cancelling sits here, away from the everyday buttons. */
export default async function OrderHistory({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const step = (FLOW_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as FlowStep) : undefined;
  const me = await requireUser();
  const o = await orderOf(id);
  const manage = can(me, "orders.manage") && o.status !== "cancelled";
  const [history, steps, m] = await Promise.all([
    orderHistoryOf(id, step),
    optional(() => orderStepsOf(id)),
    manage ? optional(() => orderMoneyOf(id)) : Promise.resolve(null),
  ]);
  const factoryPaid = (m?.factories?.rows ?? [])
    .filter((r) => Number(r.paid) > 0)
    .map((r) => `${r.currency} ${Number(r.paid).toLocaleString("en-US", { minimumFractionDigits: 2 })} to ${r.factory.name}`);
  const base = `/orders/${o.id}/history`;
  const shown = steps?.steps.map((s) => s.key) ?? [...FLOW_STEPS];
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="History"
          description={
            step ? `Changes in ${FLOW_STEP_LABEL[step]}, newest first` : "Every change, newest first, with the reason when one was asked"
          }
        />
        <CardBody className="flex flex-col gap-4">
          <Segmented
            label="Show the changes of"
            options={[
              { href: base, label: "All", active: !step },
              ...shown.map((s) => ({ href: `${base}?step=${s}`, label: FLOW_STEP_LABEL[s], active: step === s })),
            ]}
          />
          <HistoryList entries={history} empty={step ? "Nothing changed in this step yet." : undefined} />
        </CardBody>
      </Card>
      {manage && (
        <Card className="border-bad/25">
          <CardHeader
            title="Cancel the order"
            description="Only if the customer called it off. The inquiry becomes lost and can be reopened. Money is never left hanging on a cancelled order."
          />
          <CardBody>
            <CancelOrderForm
              action={cancelOrderAction.bind(null, o.id)}
              refNo={o.refNo}
              customer={o.customer.name}
              received={o.money.received}
              currency={o.currency}
              factoryPaid={factoryPaid}
              today={today()}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
