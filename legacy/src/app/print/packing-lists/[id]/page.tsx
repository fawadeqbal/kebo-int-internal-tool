import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getPackingListDetail } from "@/modules/packing/repository";
import { getSettings } from "@/modules/settings/service";
import { PackingListDocument } from "@/components/documents/packing-list-document";
import { PrintToolbar } from "../../toolbar";

export const metadata = { title: "Packing list" };

export default async function PrintPackingList({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("invoices.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getPackingListDetail(id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const pl = detail.packingList;
  return (
    <>
      <title>{`${pl.plNo} — ${customerName(detail.customer)}`}</title>
      <PrintToolbar pdfHref={`/api/packing-lists/${id}/pdf`} backHref={`/packing-lists/${id}`} label={pl.plNo} />
      <div className="shadow-xl print:shadow-none mx-auto max-w-[210mm]">
        <PackingListDocument detail={detail} settings={settings} />
      </div>
    </>
  );
}
