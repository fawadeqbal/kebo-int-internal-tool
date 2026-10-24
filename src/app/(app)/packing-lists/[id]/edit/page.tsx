import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getPackingListDetail } from "@/modules/packing/repository";
import { updatePackingListAction } from "@/modules/packing/actions";
import { PackingListForm } from "@/modules/packing/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit packing list" };

const num = (v: string) => String(Number(v));
const opt = (v: string) => (Number(v) ? String(Number(v)) : "");

export default async function EditPackingListPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("invoices.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getPackingListDetail(id) : null;
  if (!detail) notFound();
  const pl = detail.packingList;
  return (
    <>
      <PageHeader
        title={`Edit ${pl.plNo}`}
        description={`For ${detail.invoice.invoiceNo} · ${customerName(detail.customer)}`}
        backHref={`/packing-lists/${id}`}
        backLabel={pl.plNo}
      />
      <div className="max-w-5xl">
        <PackingListForm
          action={updatePackingListAction.bind(null, id)}
          cancelHref={`/packing-lists/${id}`}
          submitLabel="Save packing list"
          initial={{
            items: detail.items.map((i) => ({
              description: i.description,
              quantity: num(i.quantity),
              unit: i.unit,
              packages: String(i.packages),
              packageType: i.packageType,
              netWeight: opt(i.netWeight),
              grossWeight: opt(i.grossWeight),
              cbm: opt(i.cbm),
            })),
            packDate: pl.packDate,
            incoterm: pl.incoterm ?? "",
            portOfLoading: pl.portOfLoading ?? "",
            portOfDischarge: pl.portOfDischarge ?? "",
            finalDestination: pl.finalDestination ?? "",
            transport: pl.transport ?? "",
            containerNo: pl.containerNo ?? "",
            sealNo: pl.sealNo ?? "",
            marks: pl.marks ?? "",
            notes: pl.notes ?? "",
          }}
        />
      </div>
    </>
  );
}
