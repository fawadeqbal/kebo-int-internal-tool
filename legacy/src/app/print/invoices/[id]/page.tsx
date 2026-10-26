import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { getSettings } from "@/modules/settings/service";
import { InvoiceDocument } from "@/components/documents/documents";
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
      <PrintToolbar pdfHref={`/api/invoices/${id}/pdf`} backHref={`/invoices/${id}`} label={inv.invoiceNo} />
      <div className="shadow-xl print:shadow-none mx-auto max-w-[210mm]">
        <InvoiceDocument detail={detail} settings={settings} />
      </div>
    </>
  );
}
