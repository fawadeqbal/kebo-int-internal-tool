import type { AppSettings } from "@/modules/settings/service";
import type { getQuotationDetail } from "@/modules/quotations/repository";
import type { getInvoiceDetail } from "@/modules/invoices/repository";
import { partiesFor } from "@/modules/documents/snapshots";
import { DocumentView, docDate } from "./document-view";

type QuotationDetail = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;
type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoiceDetail>>>;

/** The quotation as the customer receives it (screen, print and PDF). */
export function QuotationDocument({ detail, settings }: { detail: QuotationDetail; settings: AppSettings }) {
  const q = detail.quotation;
  const { customer, company } = partiesFor(q, detail.customer, settings);
  return (
    <DocumentView
      kind="Quotation"
      number={q.version > 1 ? `${q.refNo}-R${q.version - 1}` : q.refNo}
      settings={company}
      currency={q.currency}
      customer={customer}
      stamp={detail.superseded ? { label: "Superseded", tone: "void" } : q.status === "draft" ? { label: "Draft", tone: "draft" } : null}
      subject={detail.query.title}
      meta={[
        { label: "Date", value: docDate(q.submittedAt ?? q.createdAt.toISOString().slice(0, 10)) },
        { label: "Valid until", value: docDate(q.dueDate) },
        { label: "Your RFQ ref.", value: detail.query.refNo },
        ...(q.version > 1 ? [{ label: "Revision", value: `${q.version - 1} (version ${q.version})` }] : []),
        { label: "Currency", value: q.currency },
        ...(detail.creatorName ? [{ label: "Prepared by", value: detail.creatorName }] : []),
      ]}
      items={detail.items}
      totals={q}
      terms={q.terms}
      bankDetails={company.bankDetails}
    />
  );
}

/** The invoice as the customer receives it (screen, print and PDF). */
export function InvoiceDocument({ detail, settings }: { detail: InvoiceDetail; settings: AppSettings }) {
  const inv = detail.invoice;
  const { customer, company } = partiesFor(inv, detail.customer, settings);
  return (
    <DocumentView
      kind="Invoice"
      number={inv.invoiceNo}
      settings={company}
      currency={inv.currency}
      customer={customer}
      stamp={inv.status === "cancelled" ? { label: "Cancelled", tone: "void" } : inv.status === "paid" ? { label: "Paid", tone: "paid" } : null}
      subject={detail.query.title}
      meta={[
        { label: "Invoice date", value: docDate(inv.issueDate) },
        { label: "Payment due", value: docDate(inv.dueDate) },
        { label: "Quotation ref.", value: detail.quotation.refNo },
        { label: "Your RFQ ref.", value: detail.query.refNo },
        { label: "Currency", value: inv.currency },
      ]}
      items={detail.items}
      totals={inv}
      terms={inv.notes}
      payment={inv.status === "cancelled" ? undefined : { bankDetails: company.bankDetails, dueDate: inv.dueDate, paidInFull: inv.status === "paid" }}
      footer={company.invoiceFooter}
    />
  );
}
