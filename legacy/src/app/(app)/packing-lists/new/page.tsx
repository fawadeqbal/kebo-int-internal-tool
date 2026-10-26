import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { packingDraft } from "@/modules/documents/drafts";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { createPackingListAction } from "@/modules/packing/actions";
import { PackingListForm } from "@/modules/packing/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New packing list" };

export default async function NewPackingListPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  await requirePagePermission("invoices.manage");
  const { invoice: invoiceId } = await searchParams;
  if (!isUuid(invoiceId)) notFound();
  const draft = await packingDraft(invoiceId).catch(async (e) => {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof DomainError) {
      // Already made: open it.
      const inv = await getInvoiceDetail(invoiceId);
      redirect(inv?.packingList ? `/packing-lists/${inv.packingList.id}` : `/invoices/${invoiceId}`);
    }
    throw e;
  });
  const { detail, initial } = draft;
  const inv = detail.invoice;
  return (
    <>
      <PageHeader
        title="New packing list"
        description={`For ${inv.invoiceNo} · ${customerName(detail.customer)} · ${detail.query.refNo}`}
        backHref={`/invoices/${inv.id}`}
        backLabel={inv.invoiceNo}
      />
      <div className="max-w-5xl">
        <PackingListForm action={createPackingListAction.bind(null, inv.id)} cancelHref={`/invoices/${inv.id}`} submitLabel="Create packing list" initial={initial} />
      </div>
    </>
  );
}
