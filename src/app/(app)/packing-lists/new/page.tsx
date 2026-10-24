import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { todayISO } from "@/lib/utils/dates";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { createPackingListAction } from "@/modules/packing/actions";
import { PackingListForm } from "@/modules/packing/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New packing list" };

export default async function NewPackingListPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  await requirePagePermission("invoices.manage");
  const { invoice: invoiceId } = await searchParams;
  const detail = isUuid(invoiceId) ? await getInvoiceDetail(invoiceId) : null;
  if (!detail) notFound();
  const inv = detail.invoice;
  if (inv.status === "cancelled") redirect(`/invoices/${inv.id}`);
  return (
    <>
      <PageHeader
        title="New packing list"
        description={`For ${inv.invoiceNo} · ${customerName(detail.customer)} · ${detail.query.refNo}`}
        backHref={`/queries/${detail.query.id}`}
        backLabel={detail.query.refNo}
      />
      <div className="max-w-5xl">
        <PackingListForm
          action={createPackingListAction.bind(null, inv.id)}
          cancelHref={`/queries/${detail.query.id}`}
          submitLabel="Create packing list"
          initial={{
            items: detail.items.map((i) => ({
              description: i.description,
              quantity: String(Number(i.quantity)),
              unit: "pcs",
              packages: "1",
              packageType: "Wooden case",
              netWeight: "",
              grossWeight: "",
              cbm: "",
            })),
            packDate: todayISO(),
            incoterm: "",
            portOfLoading: "",
            portOfDischarge: "",
            finalDestination: "",
            transport: "",
            containerNo: "",
            sealNo: "",
            marks: "",
            notes: "",
          }}
        />
      </div>
    </>
  );
}
