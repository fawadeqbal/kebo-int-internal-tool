import { can } from "@kebo/shared";
import { Badge, Card, CardHeader, EmptyState } from "@kebo/ui";
import { PackageOpen } from "lucide-react";
import { requireUser } from "@/lib/session";
import { orderOf } from "@/lib/order-data";
import { packingAction } from "../../actions";
import { PackingList } from "../goods";
import { docHref, goodsOf } from "../shared";

export const metadata = { title: "Packing list" };

/** Packages, weights and volume per line, before shipping (opens once production has started or everything is in). */
export default async function OrderPacking({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const canEdit = can(me, "orders.update") && o.status !== "cancelled";
  const goods = goodsOf(o);
  if (!goods.length) return <EmptyState icon={PackageOpen} title="No goods on this order" description="It only has charges, so there is nothing to pack." />;
  const showPacking = o.goods.allReceived || o.stage !== "confirmed";
  const badge = o.goods.packed ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Not made yet</Badge>;
  if (!showPacking)
    return (
      <Card>
        <CardHeader title="Packing list" description="Opens once production has started, for the packages, weights and volume of each line." actions={badge} />
      </Card>
    );
  return (
    <PackingList
    title="Packing list"
    description={o.goods.packed ? undefined : "Packages, weights and volume for each line, before shipping."}
    badge={badge}
    lines={goods}
    containerNo={o.goods.containerNo}
    shippingMarks={o.goods.shippingMarks}
    packed={o.goods.packed}
    totals={o.goods.totals}
    canEdit={canEdit}
    canUpload={canEdit && (o.stage === "confirmed" || o.stage === "in_production")}
    action={packingAction.bind(null, o.id)}
    links={docHref(o, { kind: "packing-list", label: "Packing list" })}
    />
  );
}
