import Link from "next/link";
import { FileText } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge, buttonClass, Card, CardHeader } from "@kebo/ui";
import { HeaderSlot } from "@/components/orders/header-slot";
import { StepFrame } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { packingAction, packingMarksAction } from "../../actions";
import { PackingCard } from "../goods";
import { docHref, goodsOf } from "../shared";
import { stepData } from "../step-data";

export const metadata = { title: "Order · packing" };

/** Packing (board OrderPacking): the container and marks, then packages, weights and volume per line; part of Shipping. */
export default async function OrderPackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "shipping");
  const { o, me, now } = d;
  const canEdit = can(me, "orders.update") && d.open;
  const goods = goodsOf(o);
  const open = o.goods.allReceived || o.stage !== "confirmed";
  const paper = docHref(o, { kind: "packing-list", label: "Packing list" });
  return (
    <StepFrame header={null} side={<StepSidePanel id={o.id} step="shipping" changes={d.changes} historyHref={d.historyHref} />}>
      {canEdit && open && (
        <HeaderSlot>
          <Link href={`/orders/${o.id}/papers/packing-list`} className={buttonClass("primary", "md")}>
            <FileText aria-hidden /> Make packing list
          </Link>
        </HeaderSlot>
      )}
      {!goods.length ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">This order has no goods lines (only charges).</p>
      ) : open ? (
        <div id="lines" data-target="lines.packing" data-target-card="" className="scroll-mt-24 rounded-xl">
          <PackingCard
            title="Packing lines"
            badge={o.goods.packed ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Not made yet</Badge>}
            orderId={o.id}
            lines={o.lines.filter((l) => l.type === "goods")}
            goods={goods}
            containerNo={o.goods.containerNo}
            containerHref={`/orders/${o.id}/shipping#goto=shipment.containerNo`}
            shippingMarks={o.goods.shippingMarks}
            canEdit={canEdit}
            canUpload={canEdit && (o.stage === "confirmed" || o.stage === "in_production")}
            action={packingAction.bind(null, o.id)}
            marksAction={packingMarksAction.bind(null, o.id)}
            links={o.goods.packed || o.goods.totals.packages > 0 ? paper : undefined}
            today={now}
          />
        </div>
      ) : (
        <Card>
          <CardHeader title="Packing lines" description="Opens once production has started, for the packages, weights and volume of each line." actions={<Badge tone="warn">Not made yet</Badge>} />
        </Card>
      )}
    </StepFrame>
  );
}
