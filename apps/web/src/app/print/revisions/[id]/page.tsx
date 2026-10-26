import type { Metadata } from "next";
import { paymentSentenceOf } from "@kebo/shared";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import type { DealDetail } from "@/lib/types";
import type { CompanySnapshot, DocLine, RevisionDoc } from "@/lib/types-orders";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, companyOr, customerOr } from "@/components/print/data";
import { docDate, docMoney, docQty, docWords, InternalTable, KeboDoc, marginOf, portBullets, textBullets, type DocColumn } from "@/components/print/kebo-doc";

const copyHref = (id: string, back: string | undefined, internal: boolean) => `/print/revisions/${id}?${new URLSearchParams({ ...(back ? { back } : {}), ...(internal ? { copy: "internal" } : {}) })}`;
const numberOf = (r: RevisionDoc) => `${r.quotation.refNo}-R${r.number}`;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ copy?: string }> }): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = await load(() => api.get<RevisionDoc>(`/revisions/${id}`));
  return { title: `Quotation ${numberOf(r)}${sp.copy === "internal" ? " (internal)" : ""}` };
}

/**
 * The quotation in Kebo's own layout (components/print/kebo-doc.tsx). The
 * customer's copy shows the items and one total; ?copy=internal adds unit
 * prices, amounts and, for people who may see them, costs and margin.
 */
export default async function QuotationPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string; copy?: string }> }) {
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
  const costs = internal && r.lines.some((l) => l.unitCost != null);

  const no: DocColumn<DocLine> = { label: "No.", width: 28.5, render: (_l, i) => i + 1 };
  const description: DocColumn<DocLine> = { label: "Equipment Description", render: (l) => `${l.description}${l.model ? `\nModel: ${l.model}` : ""}` };
  const columns: DocColumn<DocLine>[] = internal
    ? [
        no,
        description,
        { label: "Qty.", width: 58, render: (l) => docQty(l.quantity, l.unit) },
        ...(costs
          ? ([
              { label: "Unit cost", width: 62, align: "right", render: (l) => (l.unitCost != null ? docMoney(l.unitCost, c) : "") },
              { label: "Margin", width: 42, align: "right", render: (l) => marginOf(l.unitPrice, l.unitCost) },
            ] satisfies DocColumn<DocLine>[])
          : []),
        { label: "Unit price", width: 66, align: "right", render: (l) => docMoney(l.unitPrice, c) },
        { label: "Amount", width: 74, align: "right", render: (l) => docMoney(l.lineTotal, c) },
      ]
    : [no, description, { label: "Qty.", width: 71.4, render: (l) => docQty(l.quantity, l.unit) }];

  // Subtotal and discount: always on the internal copy, on the customer's only when there is a discount.
  const sums =
    internal || Number(r.discount)
      ? [
          { label: "Subtotal", value: docMoney(r.subtotal, c) },
          ...(Number(r.discount) ? [{ label: "Discount", value: docMoney(-Number(r.discount), c) }] : []),
        ]
      : [];

  return (
    <>
      <PrintToolbar
        title={`Quotation ${numberOf(r)}`}
        backHref={backTo(sp.back, `/deals/${r.quotation.inquiryId}/quotation`)}
        pdfHref={`/pdf/revisions/${r.id}${internal ? "?copy=internal" : ""}`}
        copies={{ current: internal ? "internal" : "customer", customer: copyHref(r.id, sp.back, false), internal: copyHref(r.id, sp.back, true) }}
      />
      <KeboDoc
        company={{ ...company, stamp: now.stamp ?? null }}
        customer={customer}
        title="QUOTATION"
        numberLabel="Quotation NO."
        number={numberOf(r)}
        date={r.sentOn ?? r.createdAt}
        meta={[{ label: "Valid until:", value: docDate(r.validUntil) }]}
        columns={columns}
        rows={r.lines}
        sums={sums}
        total={{ label: `Total ${r.incoterm} Price :`, words: docWords(r.total, c), amount: docMoney(r.total, c) }}
        bullets={[
          paymentSentenceOf(r.depositPercent, r.balanceTerms),
          r.leadTime ? `Delivery: ${r.leadTime}` : null,
          ...textBullets(r.terms),
          ...textBullets(r.notes),
          ...portBullets(r.incoterm, r.incotermPlace),
          `This quotation is valid until ${docDate(r.validUntil)}.`,
        ].filter(Boolean)}
        internal={
          internal && r.costing ? (
            <InternalTable
              title="Costing (internal)"
              rows={[
                ["Sales (after discount)", docMoney(r.costing.sales, c)],
                ["Factory cost", docMoney(r.costing.cost, c)],
                ["Profit", docMoney(r.costing.profit, c)],
                ["Margin", r.costing.marginPercent === null ? "—" : `${r.costing.marginPercent}%`],
              ]}
              note={r.costing.uncostedLines ? `${r.costing.uncostedLines} line(s) have no factory cost and are left out.` : null}
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
