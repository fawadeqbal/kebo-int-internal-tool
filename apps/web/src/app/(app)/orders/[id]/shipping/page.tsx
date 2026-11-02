import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { ShipmentsPanel } from "@/components/orders/flow-panels";
import { addShipmentAction, removeShipmentAction, updateShipmentAction } from "../../flow-actions";

export const metadata = { title: "Order · shipping" };

/** The shipments: sea or air, ports, forwarder, container, B/L or AWB, and the dates from booked to arrived. */
export default async function OrderShipping({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [o, flow] = await Promise.all([orderOf(id), optional(() => orderFlowOf(id))]);
  if (!flow?.shipping) notFound();
  const canEdit = can(me, "shipping.manage") && o.status !== "cancelled";
  const shipments = flow.shipping.shipments;
  const base = `/orders/${o.id}`;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title={shipments.length ? `Shipping · ${shipments.length === 1 ? "1 shipment" : `${shipments.length} shipments`}` : "Shipping"}
          description={
            <>
              Costs (freight, trucking, insurance) are recorded as expenses on{" "}
              <Link href={`${base}/money`} className="text-primary hover:underline">
                Payments
              </Link>
              {o.goods.lines > 0 && (
                <>
                  ; packages and weights on the{" "}
                  <Link href={`${base}/packing`} className="text-primary hover:underline">
                    Packing list
                  </Link>
                </>
              )}
              .
            </>
          }
        />
        <CardBody>
          <ShipmentsPanel
            addAction={addShipmentAction.bind(null, o.id)}
            updateActions={Object.fromEntries(shipments.map((s) => [s.id, updateShipmentAction.bind(null, o.id, s.id)]))}
            removeActions={Object.fromEntries(shipments.map((s) => [s.id, removeShipmentAction.bind(null, o.id, s.id)]))}
            shipments={shipments}
            defaults={{ mode: "sea", status: "planned", portOfLoading: o.incotermPlace, portOfDischarge: o.portOfDischarge, blNo: o.blNo, containerNo: o.goods.containerNo }}
            today={today()}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>
    </div>
  );
}
