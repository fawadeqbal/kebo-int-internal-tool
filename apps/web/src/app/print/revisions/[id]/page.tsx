import type { Metadata } from "next";
import { BALANCE_TERMS_LABEL } from "@kebo/shared";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { RevisionDoc } from "@/lib/types-orders";
import {
  Columns,
  customerLines,
  Describe,
  FactsBox,
  Letterhead,
  LinesTable,
  num,
  PartyBox,
  Sheet,
  SignOff,
  TextBlock,
  Totals,
} from "@/components/print/doc";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, companyOr, customerOr } from "@/components/print/data";

const numberOf = (r: RevisionDoc) => `${r.quotation.refNo}-R${r.number}`;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await load(() => api.get<RevisionDoc>(`/revisions/${id}`));
  return { title: `Quotation ${numberOf(r)}` };
}

/** The quotation as the customer sees it: prices only, never our costs. */
export default async function QuotationPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = await load(() => api.get<RevisionDoc>(`/revisions/${id}`));
  const [company, customer] = await Promise.all([
    companyOr(r.companySnapshot),
    customerOr(r.customerSnapshot, async () => {
      const deal = await api.get<DealDetail>(`/inquiries/${r.quotation.inquiryId}`);
      return { customerId: deal.customer.id, contactId: deal.contactId };
    }),
  ]);
  const vat = r.vatRate > 0 ? `${r.pricesIncludeVat ? "Incl. " : ""}VAT ${r.vatRate}%` : null;
  const terms = `${r.depositPercent > 0 ? `${r.depositPercent}% deposit with the order; ` : ""}${BALANCE_TERMS_LABEL[r.balanceTerms]}`;
  return (
    <>
      <PrintToolbar
        title={`Quotation ${numberOf(r)}`}
        backHref={backTo(sp.back, `/deals/${r.quotation.inquiryId}/quotation`)}
        pdfHref={`/pdf/revisions/${r.id}`}
      />
      <Sheet watermark={r.status === "draft" ? "DRAFT" : null}>
        <Letterhead
          company={company}
          title="Quotation"
          number={numberOf(r)}
          meta={[
            { label: "Date", value: date(r.sentOn ?? r.createdAt) },
            { label: "Valid until", value: date(r.validUntil) },
            { label: "Currency", value: r.currency },
          ]}
        />
        <Columns>
          <PartyBox title="Quoted to" party={customerLines(customer)} />
          <FactsBox
            title="Terms of sale"
            items={[
              { label: "Incoterm", value: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""} (Incoterms® 2020)` },
              { label: "Payment", value: terms },
              { label: "Lead time", value: r.leadTime },
              { label: "Valid until", value: date(r.validUntil) },
            ]}
          />
        </Columns>
        <LinesTable
          rows={r.lines}
          columns={[
            { label: "No.", className: "w-8 text-[#64748b]", render: (_l, i) => i + 1 },
            { label: "Description", render: (l) => <Describe description={l.description} model={l.model} hsCode={l.hsCode} /> },
            { label: "Qty", className: "w-16 text-right", render: (l) => num(l.quantity) },
            { label: "Unit", className: "w-12", render: (l) => l.unit },
            { label: "Unit price", className: "w-28 text-right tabular whitespace-nowrap", render: (l) => money(l.unitPrice, r.currency) },
            {
              label: "Amount",
              className: "w-32 text-right tabular whitespace-nowrap font-medium",
              render: (l) => money(l.lineTotal, r.currency),
            },
          ]}
        />
        <Totals
          currency={r.currency}
          total={r.total}
          rows={[
            { label: "Subtotal", value: money(r.subtotal, r.currency) },
            { label: "Discount", value: Number(r.discount) ? `− ${money(r.discount, r.currency)}` : null },
            { label: vat ?? "VAT", value: vat ? money(r.vatAmount, r.currency) : null },
          ]}
          totalLabel={`Total ${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}`}
        />
        <TextBlock title="Terms and conditions">{r.terms}</TextBlock>
        <TextBlock title="Notes">{r.notes}</TextBlock>
        <SignOff left={`For and on behalf of ${company.name}`} right="Accepted by the buyer (signature, stamp and date)" />
      </Sheet>
    </>
  );
}
