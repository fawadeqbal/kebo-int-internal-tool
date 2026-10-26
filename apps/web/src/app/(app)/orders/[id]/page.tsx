import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import type { OrderView } from "@/lib/types";
import { Checklist } from "@/components/orders/checklist";
import { cancelOrderAction, datesAction, stepAction } from "../actions";
import { CancelOrderForm, DatesForm } from "./forms";

export const metadata = { title: "Order" };

export default async function OrderChecklist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await api.get<OrderView>(`/orders/${id}`);
  const canEdit = can(me.role, "milestones.update");
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader title="Checklist" description={`${o.plan.done} of ${o.plan.total} steps done${o.plan.overdue ? ` · ${o.plan.overdue} late` : ""}. Steps tick themselves when you record the payment, factory order, invoice or shipment.`} />
        <CardBody>
          <Checklist plan={o.plan} action={stepAction.bind(null, o.id)} canEdit={canEdit} canOverride={can(me.role, "milestones.override")} open={o.status !== "cancelled"} />
        </CardBody>
      </Card>
      <aside className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Dates" description="The later due dates follow these." />
          <CardBody>
            <DatesForm action={datesAction.bind(null, o.id)} shipBy={o.shipBy} readyOn={o.readyOn} canEdit={canEdit} />
          </CardBody>
        </Card>
        {can(me.role, "orders.manage") && o.status !== "cancelled" && (
          <Card>
            <CardHeader title="Cancel the order" description="Only if the customer called it off. The deal becomes lost and can be reopened." />
            <CardBody>
              <CancelOrderForm action={cancelOrderAction.bind(null, o.id)} />
            </CardBody>
          </Card>
        )}
      </aside>
    </div>
  );
}
