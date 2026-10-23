import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { createInvoiceAction } from "@/modules/invoices/actions";
import { InvoiceForm } from "@/modules/invoices/components";
import { getSettings } from "@/modules/settings/service";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Generate invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ quotation?: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { quotation: quotationId } = await searchParams;
  const detail = isUuid(quotationId) ? await getQuotationDetail(user, quotationId) : null;
  if (!detail) notFound();
  if (detail.quotation.status !== "accepted" || detail.invoices.some((i) => i.status !== "cancelled")) redirect(`/quotations/${quotationId}`);
  const settings = await getSettings();
  const q = detail.quotation;
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Generate invoice"
        description={`From ${q.refNo} (v${q.version}) · ${customerName(detail.customer)} · ${detail.query.refNo}`}
        backHref={`/quotations/${q.id}`}
        backLabel={q.refNo}
      />
      <div className="max-w-5xl">
        <InvoiceForm
          action={createInvoiceAction.bind(null, q.id)}
          currency={settings.currency}
          cancelHref={`/quotations/${q.id}`}
          initial={{
            items: detail.items.map((i) => ({ description: i.description, quantity: String(Number(i.quantity)), unitPrice: String(Number(i.unitPrice)) })),
            discount: String(Number(q.discount)),
            taxRate: String(Number(q.taxRate)),
            issueDate: today,
            dueDate: addDaysISO(today, settings.invoicePaymentDays),
            notes: "",
          }}
        />
      </div>
    </>
  );
}
