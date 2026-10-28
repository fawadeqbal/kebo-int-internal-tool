import { can } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@kebo/ui";
import { PackageOpen } from "lucide-react";
import { requireUser } from "@/lib/session";
import { orderOf } from "@/lib/order-data";
import { today } from "@/components/orders/today";
import { receiptAction } from "../../actions";
import { GoodsExcel, GoodsReceipt } from "../goods";
import { goodsOf } from "../shared";

export const metadata = { title: "Goods from the factory" };

/** What came in from the factory, line by line. */
export default async function OrderGoods({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const canEdit = can(me, "orders.update") && o.status !== "cancelled";
  const goods = goodsOf(o);
  if (!goods.length) return <EmptyState icon={PackageOpen} title="No goods on this order" description="It only has charges, so there is nothing to receive or pack." />;
  return (
    <Card>
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
        <GoodsReceipt key={goods.map((l) => l.receivedQty).join()} lines={goods} canEdit={canEdit} action={receiptAction.bind(null, o.id)} today={today()} />
      </CardBody>
    </Card>
  );
}
