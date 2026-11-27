import { date } from "@/lib/format";
import type { OrderView } from "@/lib/types-orders";
import type { OrderPapers } from "@/lib/types-papers";
import type { PaperLineRow } from "@/components/orders/papers-table";
import type { GoodsLine } from "./goods";

/** Where a document of the order opens (view / print) and downloads (PDF). */
export const docHref = (o: OrderView, d: OrderView["documents"][number]) =>
  d.kind === "quotation"
    ? { view: `/print/revisions/${d.revisionId}?back=/orders/${o.id}/documents`, pdf: `/pdf/revisions/${d.revisionId}` }
    : { view: `/print/orders/${o.id}/${d.kind}?back=/orders/${o.id}/documents`, pdf: `/pdf/${d.kind}/${o.id}` };

/**
 * Every document of the order once, as Documents lists them and the order's window goes through them: the
 * quotation the order was made from (its own print page), then the API's papers, the proforma with its internal copy.
 */
export function paperRowsOf(o: OrderView, papers: OrderPapers | null): PaperLineRow[] {
  const quotation = o.documents.find((x) => x.kind === "quotation");
  const proforma = o.documents.find((x) => x.kind === "proforma");
  return [
    ...(quotation
      ? [
          {
            key: "quotation",
            kind: "quotation",
            source: "app" as const,
            label: quotation.label,
            step: "payment" as const,
            state: "ready" as const,
            stateLabel: "Ready",
            number: null,
            version: null,
            sub: "accepted",
            ref: null,
            printable: true,
            makeable: false,
            live: true,
            inSet: false,
            doc: null,
            docKind: null,
            links: { ...docHref(o, quotation), internal: `${docHref(o, quotation).pdf}?copy=internal` },
          },
        ]
      : []),
    ...(papers?.papers ?? []).map((p) =>
      p.kind === "proforma" && proforma
        ? { ...p, links: { ...docHref(o, proforma), internal: `${docHref(o, proforma).pdf}?copy=internal` } }
        : p,
    ),
  ];
}

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
