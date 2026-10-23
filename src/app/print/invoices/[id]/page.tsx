import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { getSettings } from "@/modules/settings/service";
import { DocumentView, docDate } from "@/components/documents/document-view";
import { PrintToolbar } from "../../toolbar";

export const metadata = { title: "Invoice" };

export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("invoices.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getInvoiceDetail(id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const inv = detail.invoice;
  return (
    <>
      <title>{`${inv.invoiceNo} — ${customerName(detail.customer)}`}</title>
      <PrintToolbar backHref={`/invoices/${id}`} label={inv.invoiceNo} />
      <div className="shadow-xl print:shadow-none mx-auto max-w-[210mm]">
        <DocumentView
          kind="Invoice"
          number={inv.invoiceNo}
          settings={settings}
          customer={detail.customer}
          stamp={inv.status === "cancelled" ? "Cancelled" : inv.status === "paid" ? "Paid" : null}
          meta={[
            { label: "Invoice date", value: docDate(inv.issueDate) },
            { label: "Payment due", value: docDate(inv.dueDate) },
            { label: "Quotation", value: detail.quotation.refNo },
            { label: "Our reference", value: detail.query.refNo },
          ]}
          items={detail.items}
          totals={inv}
          terms={inv.notes}
          footer={settings.invoiceFooter}
        />
      </div>
    </>
  );
}
