import type { Metadata } from "next";
import { fromMinor, landedUnitCosts, toMinor } from "@kebo/money";
import { basisText, paymentSentenceOf } from "@kebo/shared";
import { api } from "@/lib/api";
import { docBrand, hasFeature, load } from "@/lib/session";
import type { DealDetail } from "@/lib/types";
import type { CompanySnapshot, DocLine, RevisionDoc } from "@/lib/types-orders";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, companyOr, customerOr } from "@/components/print/data";
import {
  docDate,
  docItem,
  docMoney,
  docQty,
  docWords,
  InternalTable,
  KeboDoc,
  marginOf,
  portBullets,
  textBullets,
  type DocColumn,
} from "@/components/print/kebo-doc";

const copyHref = (id: string, back: string | undefined, internal: boolean) =>
  `/print/revisions/${id}?${new URLSearchParams({ ...(back ? { back } : {}), ...(internal ? { copy: "internal" } : {}) })}`;
const numberOf = (r: RevisionDoc) => `${r.quotation.refNo}-R${r.number}`;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ copy?: string }>;
}): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = await load(() => api.get<RevisionDoc>(`/revisions/${id}`));
  return { title: `Quotation ${numberOf(r)}${sp.copy === "internal" ? " (internal)" : ""}` };
}

/**
 * The quotation in Kebo's own layout (components/print/kebo-doc.tsx). The
 * customer's copy shows the items and one total; ?copy=internal adds unit
 * prices, amounts and, for people who may see them, costs and margin.
 */
export default async function QuotationPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; copy?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = await load(() => api.get<RevisionDoc>(`/revisions/${id}`));
  const [company, customer, now] = await Promise.all([
    companyOr(r.companySnapshot),
    customerOr(r.customerSnapshot, async () => {
      const deal = await api.get<DealDetail>(`/inquiries/${r.quotation.inquiryId}`);
      return { customerId: deal.customer.id, contactId: deal.contactId };
    }),
    // The stamp is not frozen with the letterhead: documents print the current one.
    api.get<{ company: CompanySnapshot }>("/settings").then((s) => s.company),
  ]);
  const c = r.currency;
  const internal = sp.copy === "internal";
  // Once the customer accepted one option, the quotation shows that one; before, every option.
  const options = r.options.some((o) => o.status === "accepted") ? r.options.filter((o) => o.status === "accepted") : r.options;
  const single = options.length === 1;
  const costs = internal && options.some((o) => o.lines.some((l) => l.unitCost != null));
  // On the internal copy, each line's cost is its landed cost: the factory's plus its share of the costs to reach our basis.
  const landed = internal && options.some((o) => (o.costing?.extraCostMinor ?? 0) > 0);
  const rowsOf = (o: (typeof options)[number]) => {
    const extra = o.costing?.extraCostMinor ?? 0;
    if (!internal || !extra) return o.lines;
    const per = landedUnitCosts(
      o.lines.map((l) => ({ unitCostMinor: l.unitCost == null ? null : toMinor(l.unitCost), quantity: l.quantity })),
      extra,
    );
    return o.lines.map((l, i) => ({ ...l, unitCost: per[i] == null ? l.unitCost : fromMinor(per[i]!) }));
  };

  const no: DocColumn<DocLine> = { label: "No.", width: 28.5, render: (l, i) => l.no ?? i + 1 };
  const description: DocColumn<DocLine> = {
    label: "Equipment Description",
    render: (l) => docItem(l.description, l.model),
  };
  const columns: DocColumn<DocLine>[] = internal
    ? [
        no,
        description,
        { label: "Qty.", width: 58, render: (l) => docQty(l.quantity, l.unit) },
        ...(costs
          ? ([
              { label: landed ? "Landed cost" : "Unit cost", width: 62, align: "right", render: (l) => (l.unitCost != null ? docMoney(l.unitCost, c) : "") },
              { label: "Margin", width: 42, align: "right", render: (l) => marginOf(l.unitPrice, l.unitCost) },
            ] satisfies DocColumn<DocLine>[])
          : []),
        { label: "Unit price", width: 66, align: "right", render: (l) => docMoney(l.unitPrice, c) },
        { label: "Amount", width: 74, align: "right", render: (l) => docMoney(l.lineTotal, c) },
      ]
    : [no, description, { label: "Qty.", width: 71.4, render: (l) => docQty(l.quantity, l.unit) }];

  // Each option: its lines and its own total. Subtotal and discount: always on the internal copy, on the customer's only when there is a discount.
  const groups = options.map((o) => ({
    heading: single ? "" : `OPTION ${o.letter}${o.leadTime ? ` — delivery ${o.leadTime}` : ""}${internal && o.factory ? ` (${o.factory.name})` : ""}`,
    rows: rowsOf(o),
    sums:
      internal || Number(o.discount)
        ? [
            { label: single ? "Subtotal" : `Option ${o.letter} subtotal`, value: docMoney(o.subtotal, c) },
            ...(Number(o.discount) ? [{ label: "Discount", value: docMoney(-Number(o.discount), c) }] : []),
          ]
        : [],
    total: { label: `${single ? "" : `Option ${o.letter} `}Total ${r.incoterm} Price :`, words: docWords(o.total, c), amount: docMoney(o.total, c) },
  }));

  return (
    <>
      <PrintToolbar
        title={`Quotation ${numberOf(r)}`}
        backHref={backTo(sp.back, `/inquiries/${r.quotation.inquiryId}/quotation`)}
        pdfHref={`/pdf/revisions/${r.id}${internal ? "?copy=internal" : ""}`}
        excelHref={(await hasFeature("excel")) ? `/sheets/export/quotation?id=${r.id}${internal ? "&copy=internal" : ""}` : undefined}
        copies={{
          current: internal ? "internal" : "customer",
          customer: copyHref(r.id, sp.back, false),
          internal: copyHref(r.id, sp.back, true),
        }}
      />
      <KeboDoc
        brand={await docBrand()}
        company={{ ...company, stamp: now.stamp ?? null }}
        customer={customer}
        title="QUOTATION"
        numberLabel="Quotation NO."
        number={numberOf(r)}
        date={r.sentOn ?? r.createdAt}
        meta={[{ label: "Valid until:", value: docDate(r.validUntil) }]}
        columns={columns}
        rows={[]}
        groups={groups}
        bullets={[
          paymentSentenceOf(r.depositPercent, r.balanceTerms),
          ...textBullets(r.paymentTerms),
          single ? (options[0]!.leadTime ? `Delivery: ${options[0]!.leadTime}` : null) : null,
          ...textBullets(r.deliveryTerms),
          single ? null : `Please choose one of the ${options.length} options above (${options.map((o) => o.letter).join(", ")}); each is priced on its own.`,
          ...textBullets(r.notes),
          ...portBullets(r.incoterm, r.incotermPlace),
          `This quotation is valid until ${docDate(r.validUntil)}.`,
        ].filter(Boolean)}
        internal={
          internal && options.some((o) => o.costing) ? (
            <InternalTable
              title="Costing (internal)"
              head={single ? undefined : ["", ...options.map((o) => `Option ${o.letter}`)]}
              rows={[
                ["Factory", ...options.map((o) => o.factory?.name ?? "—")],
                ["Factory price basis", ...options.map((o) => basisText(o.factoryBasis ?? null, o.factoryBasisPlace ?? null) ?? "—")],
                ["Sales (after discount)", ...options.map((o) => (o.costing ? docMoney(o.costing.sales, c) : "—"))],
                ...(options.some((o) => o.costing && o.costing.extraCostMinor > 0)
                  ? [
                      ["Factory cost", ...options.map((o) => (o.costing ? docMoney(fromMinor(o.costing.costMinor - o.costing.extraCostMinor), c) : "—"))],
                      [`Costs to reach ${r.incoterm}`, ...options.map((o) => (o.costing ? docMoney(o.costing.extraCost, c) : "—"))],
                      ["Total cost", ...options.map((o) => (o.costing ? docMoney(o.costing.cost, c) : "—"))],
                    ]
                  : [["Factory cost", ...options.map((o) => (o.costing ? docMoney(o.costing.cost, c) : "—"))]]),
                ["Profit", ...options.map((o) => (o.costing ? docMoney(o.costing.profit, c) : "—"))],
                ["Margin", ...options.map((o) => (o.costing?.marginPercent == null ? "—" : `${o.costing.marginPercent}%`))],
              ]}
              note={options.some((o) => o.costing?.uncostedLines) ? "Lines without a factory cost are left out." : null}
            />
          ) : internal ? (
            <span />
          ) : null
        }
        watermark={r.status === "draft" ? "DRAFT" : null}
      />
    </>
  );
}
