import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { invoiceDraft } from "@/modules/documents/drafts";
import { createInvoiceAction } from "@/modules/invoices/actions";
import { InvoiceForm } from "@/modules/invoices/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Generate invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ quotation?: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { quotation: quotationId } = await searchParams;
  if (!isUuid(quotationId)) notFound();
  const draft = await invoiceDraft(user, quotationId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof DomainError) redirect(`/quotations/${quotationId}?toast=${encodeURIComponent(e.message)}`);
    throw e;
  });
  const { detail } = draft;
  const q = detail.quotation;
  return (
    <>
      <PageHeader
        title="Generate invoice"
        description={`From ${q.refNo} (v${q.version}) · ${customerName(detail.customer)} · ${detail.query.refNo} · lines copied from the accepted quotation`}
        backHref={`/quotations/${q.id}`}
        backLabel={q.refNo}
      />
      <div className="max-w-5xl">
        <InvoiceForm action={createInvoiceAction.bind(null, q.id)} currency={draft.currency} cancelHref={`/quotations/${q.id}`} initial={draft.initial} />
      </div>
    </>
  );
}
