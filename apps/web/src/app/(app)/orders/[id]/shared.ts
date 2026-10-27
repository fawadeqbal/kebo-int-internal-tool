import { BALANCE_TERMS_LABEL } from "@kebo/shared";
import { date } from "@/lib/format";
import type { OrderView } from "@/lib/types-orders";
import type { GoodsLine } from "./goods";

/** Where a document of the order opens (view / print) and downloads (PDF). */
export const docHref = (o: OrderView, d: OrderView["documents"][number]) =>
  d.kind === "quotation"
    ? { view: `/print/revisions/${d.revisionId}?back=/orders/${o.id}/documents`, pdf: `/pdf/revisions/${d.revisionId}` }
    : { view: `/print/orders/${o.id}/${d.kind}?back=/orders/${o.id}/documents`, pdf: `/pdf/${d.kind}/${o.id}` };

/** The goods lines (charges are not shipped), as the goods and packing forms use them. */
export const goodsOf = (o: OrderView): GoodsLine[] =>
  o.lines
    .filter((l) => l.type === "goods")
    .map((l) => ({
      id: l.id,
      no: l.no,
      description: l.description,
      model: l.model,
      quantity: l.quantity,
      unit: l.unit,
      factory: l.factory?.name ?? null,
      receivedQty: l.receivedQty,
      receivedOn: l.receivedOn ? date(l.receivedOn) : null,
      packing: l.packing,
    }));

/** "30% deposit, balance before shipment". */
export function termsOf(o: OrderView) {
  const balance = BALANCE_TERMS_LABEL[o.balanceTerms];
  return o.depositPercent > 0 ? `${o.depositPercent}% deposit, ${balance.charAt(0).toLowerCase()}${balance.slice(1)}` : balance;
}

export const incotermOf = (o: OrderView) => `${o.incoterm}${o.incotermPlace ? ` ${o.incotermPlace}` : ""}`;
