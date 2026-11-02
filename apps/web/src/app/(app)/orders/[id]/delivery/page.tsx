import { notFound } from "next/navigation";
import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderOf } from "@/lib/order-data";
import type { Person } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { ClaimsPanel, DeliveryPanel, SatPanel } from "@/components/orders/flow-panels";
import { addClaimAction, deliveryAction, satAction, updateClaimAction } from "../../flow-actions";

export const metadata = { title: "Order · delivery and SAT" };

/** At the customer's: delivery and its condition, the site acceptance test by our engineer, and any claims. */
export default async function OrderDelivery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [o, flow, people] = await Promise.all([orderOf(id), optional(() => orderFlowOf(id)), optional(() => api.get<Person[]>("/users/people"))]);
  if (!flow?.delivery) notFound();
  const d = flow.delivery;
  const canEdit = can(me, "delivery.manage") && o.status !== "cancelled";
  const now = today();
  const arrived = flow.shipping?.shipments.map((s) => s.arrivedOn).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Delivery and site acceptance" description={o.customer.name} />
        <CardBody>
          <DeliveryPanel action={deliveryAction.bind(null, o.id)} d={d} people={people ?? []} arrivedOn={arrived} today={now} canEdit={canEdit} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="SAT checklist" description={d.satDoneOn ? "Signed off; reopen the SAT to change it." : "What our engineer checks on site, from the customer's URS."} />
        <CardBody>
          <SatPanel action={satAction.bind(null, o.id)} checks={d.sat} suggested={d.suggestedSat} locked={!!d.satDoneOn} canEdit={canEdit} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Claims" description="Damage, missing parts or faults after delivery, and how each was settled." />
        <CardBody>
          <ClaimsPanel
            addAction={addClaimAction.bind(null, o.id)}
            updateActions={Object.fromEntries(d.claims.map((c) => [c.id, updateClaimAction.bind(null, o.id, c.id)]))}
            claims={d.claims}
            today={now}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>
    </div>
  );
}
