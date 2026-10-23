import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { getSettings } from "@/modules/settings/service";
import { QuotationDocument } from "@/components/documents/documents";
import { PrintToolbar } from "../../toolbar";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Quotation ${id.slice(0, 8)}` };
}

export default async function PrintQuotation({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = isUuid(id) ? await getQuotationDetail(user, id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const q = detail.quotation;
  return (
    <>
      <title>{`${q.refNo} — ${customerName(detail.customer)}`}</title>
      <PrintToolbar pdfHref={`/api/quotations/${id}/pdf`} backHref={`/quotations/${id}`} label={q.refNo} />
      <div className="shadow-xl print:shadow-none mx-auto max-w-[210mm]">
        <QuotationDocument detail={detail} settings={settings} />
      </div>
    </>
  );
}
