import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { FactoryOrderPanel, ProductionPanel } from "@/components/orders/flow-panels";
import { factoryOrderAction, productionAction } from "../../flow-actions";

export const metadata = { title: "Order · factory" };

/** Ordering from the factory and its production timeline; what came in is on Goods from factory, what we paid them on Payments. */
export default async function OrderFactory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [o, flow] = await Promise.all([orderOf(id), optional(() => orderFlowOf(id))]);
  if (!flow) notFound();
  const canEdit = can(me, "orders.update") && o.status !== "cancelled";
  const base = `/orders/${o.id}`;
  const now = today();
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Order with the factory"
          description={
            <>
              What we paid them is on{" "}
              <Link href={`${base}/money`} className="text-primary hover:underline">
                Payments
              </Link>
              {o.goods.lines > 0 && (
                <>
                  ; what came in, on{" "}
                  <Link href={`${base}/goods`} className="text-primary hover:underline">
                    Goods from factory
                  </Link>
                </>
              )}
              .
            </>
          }
        />
        <CardBody>
          <FactoryOrderPanel action={factoryOrderAction.bind(null, o.id)} orderedOn={flow.factory.orderedOn} readyOn={flow.factory.readyOn} factories={flow.factory.factories} today={now} canEdit={canEdit} />
        </CardBody>
      </Card>
      {flow.production && (
        <Card>
          <CardHeader title="Production timeline" description="The factory's milestones up to ready: tick each off as they report it." />
          <CardBody>
            <ProductionPanel
              action={productionAction.bind(null, o.id)}
              steps={flow.production.steps}
              suggested={flow.production.suggested}
              factories={flow.factory.factories}
              today={now}
              canEdit={canEdit}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
