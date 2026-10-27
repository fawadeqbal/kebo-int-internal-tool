import { can } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@kebo/ui";
import { PackageOpen } from "lucide-react";
import { requireUser } from "@/lib/session";
import { orderOf } from "@/lib/order-data";
import { today } from "@/components/orders/today";
import { packingAction, receiptAction } from "../../actions";
import { GoodsReceipt, PackingList } from "../goods";
import { docHref, goodsOf } from "../shared";

export const metadata = { title: "Goods and packing" };

/** What came in from the factory, line by line, then the packing list (once everything is in). */
export default async function OrderGoods({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const canEdit = can(me, "orders.update") && o.status !== "cancelled";
  const goods = goodsOf(o);
  if (!goods.length) return <EmptyState icon={PackageOpen} title="No goods on this order" description="It only has charges, so there is nothing to receive or pack." />;
  const showPacking = o.goods.allReceived || o.stage !== "confirmed";
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Goods from the factory"
          description={
            o.goods.allReceived
              ? "Everything has come in."
              : `${o.goods.received} of ${o.goods.lines} item${o.goods.lines === 1 ? "" : "s"} complete. Record what comes in as it arrives.`
          }
          actions={o.goods.allReceived ? <Badge tone="ok">All in</Badge> : undefined}
        />
        <CardBody>
          <GoodsReceipt key={goods.map((l) => l.receivedQty).join()} lines={goods} canEdit={canEdit} action={receiptAction.bind(null, o.id)} today={today()} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Packing list"
          description={
            showPacking
              ? o.goods.packed
                ? undefined
                : "Packages, weights and volume for each line, before shipping."
              : "Opens once production has started, for the packages, weights and volume of each line."
          }
          actions={o.goods.packed ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Not made yet</Badge>}
        />
        {showPacking && (
          <CardBody>
            <PackingList
              lines={goods}
              containerNo={o.goods.containerNo}
              shippingMarks={o.goods.shippingMarks}
              packed={o.goods.packed}
              totals={o.goods.totals}
              canEdit={canEdit}
              action={packingAction.bind(null, o.id)}
              links={docHref(o, { kind: "packing-list", label: "Packing list" })}
            />
          </CardBody>
        )}
      </Card>
    </div>
  );
}
