import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { NotFoundError } from "@/lib/utils/result";
import { packingEditValues } from "@/modules/documents/drafts";
import { updatePackingListAction } from "@/modules/packing/actions";
import { PackingListForm } from "@/modules/packing/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit packing list" };

export default async function EditPackingListPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("invoices.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const values = await packingEditValues(id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!values) notFound();
  const { pl: detail, initial } = values;
  const pl = detail.packingList;
  return (
    <>
      <PageHeader title={`Edit ${pl.plNo}`} description={`For ${detail.invoice.invoiceNo} · ${customerName(detail.customer)}`} backHref={`/packing-lists/${id}`} backLabel={pl.plNo} />
      <div className="max-w-5xl">
        <PackingListForm action={updatePackingListAction.bind(null, id)} cancelHref={`/packing-lists/${id}`} submitLabel="Save packing list" initial={initial} />
      </div>
    </>
  );
}
