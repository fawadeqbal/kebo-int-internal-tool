import { can } from "@kebo/shared";
import { date } from "@/lib/format";
import { GoodsReceived } from "@/components/orders/goods-received";
import { StepFrame } from "@/components/orders/step-page";
import { StepSidePanel } from "@/components/orders/side-panel";
import { stepData } from "../step-data";
import { GoodsExcel } from "../goods";
import { goodsOf } from "../shared";

export const metadata = { title: "Order · goods" };

/** Goods (board OrderGoods): what came in from the factory, line by line; part of the Production step. */
export default async function OrderGoodsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await stepData(id, "production");
  const { o, me, now } = d;
  const lines = o.lines.filter((l) => l.type === "goods");
  const canEdit = can(me, "orders.update") && d.open;
  return (
    <StepFrame header={null} side={<StepSidePanel id={o.id} step="production" changes={d.changes} historyHref={d.historyHref} />}>
      {lines.length ? (
        <>
          <GoodsReceived
            orderId={o.id}
            canEdit={canEdit}
            today={now}
            lines={lines.map((l) => ({
              id: l.id,
              no: l.no,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              receivedQty: l.receivedQty,
              receivedOn: l.receivedOn ? date(l.receivedOn) : null,
            }))}
          />
          <div className="flex justify-end">
            <GoodsExcel lines={goodsOf(o)} />
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">This order has no goods lines (only charges).</p>
      )}
    </StepFrame>
  );
}
