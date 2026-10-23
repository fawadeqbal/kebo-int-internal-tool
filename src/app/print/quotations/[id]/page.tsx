import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { getSettings } from "@/modules/settings/service";
import { DocumentView, docDate } from "@/components/documents/document-view";
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
        <DocumentView
          kind="Quotation"
          number={q.refNo}
          settings={settings}
          customer={detail.customer}
          stamp={q.status === "draft" ? "Draft" : null}
          meta={[
            { label: "Date", value: docDate(q.submittedAt ?? q.createdAt.toISOString().slice(0, 10)) },
            { label: "Valid until", value: docDate(q.dueDate) },
            { label: "RFQ no.", value: detail.query.refNo },
            ...(q.version > 1 ? [{ label: "Revision", value: `v${q.version}` }] : []),
          ]}
          items={detail.items}
          totals={q}
          terms={q.terms}
        />
      </div>
    </>
  );
}
