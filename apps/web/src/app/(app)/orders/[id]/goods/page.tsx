import { can } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import { StepFrame } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { LinesCard } from "@/components/orders/step-view";
import { OrderLines, OrderLinesEditor, PhoneLines } from "@/components/orders/order-lines";
import { editsOf } from "@/lib/edit-data";
import { stepData } from "../step-data";
import { GoodsExcel } from "../goods";
import { goodsOf } from "../shared";

export const metadata = { title: "Order · goods" };

/**
 * Goods (board OrderGoods): what came in from the factory, line by line; part of the Production step.
 * Read only; Edit lines opens them in the edit panel (the same card as on Production).
 */
export default async function OrderGoodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "production");
  const { o, me, now } = d;
  const lines = o.lines.filter((l) => l.type === "goods");
  const canEdit = can(me, "orders.update") && d.open;
  const edits = await editsOf("order", o.id);
  const card = edits.cards["lines.received"];
  return (
    <StepFrame header={null} side={<StepSidePanel id={o.id} step="production" changes={d.changes} historyHref={d.historyHref} />}>
      {lines.length ? (
        <LinesCard
          target="lines.received"
          title="Lines · from the factory"
          description={o.goods.allReceived ? "Everything has come in." : "What has come in so far on each line; the status follows."}
          canEdit={canEdit}
          view={<OrderLines set="received" orderId={o.id} lines={lines} canEdit={false} today={now} />}
          edit={<OrderLinesEditor set="received" orderId={o.id} lines={lines} today={now} edit={{ type: "order", id: o.id, card: "lines.received" }} card={card} />}
          phone={<PhoneLines set="received" lines={lines} />}
          panelTitle="Edit lines · from the factory"
          panelDescription="What has come in on each line, and when. Nothing is saved until Save changes."
          edits={card}
          actions={
            <>
              {o.goods.allReceived && <Badge tone="ok">All in</Badge>}
              <GoodsExcel lines={goodsOf(o)} />
            </>
          }
        />
      ) : (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">This order has no goods lines (only charges).</p>
      )}
    </StepFrame>
  );
}
