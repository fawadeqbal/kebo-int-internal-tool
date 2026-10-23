import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { updateQuotationAction } from "@/modules/quotations/actions";
import { QuotationForm } from "@/modules/quotations/components";
import { isEditable } from "@/modules/quotations/workflow";
import { getSettings } from "@/modules/settings/service";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("quotations.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getQuotationDetail(user, id) : null;
  if (!detail) notFound();
  if (!isEditable(detail.quotation.status)) redirect(`/quotations/${id}`);
  const settings = await getSettings();
  const q = detail.quotation;
  return (
    <>
      <PageHeader
        title={`Edit ${q.refNo} (v${q.version})`}
        description={`${customerName(detail.customer)} · ${detail.query.refNo}: ${detail.query.title}`}
        backHref={`/quotations/${id}`}
        backLabel={q.refNo}
      />
      <div className="max-w-5xl">
        <QuotationForm
          action={updateQuotationAction.bind(null, id)}
          currency={settings.currency}
          cancelHref={`/quotations/${id}`}
          submitLabel="Save changes"
          initial={{
            items: detail.items.map((i) => ({ description: i.description, quantity: String(Number(i.quantity)), unitPrice: String(Number(i.unitPrice)) })),
            discount: String(Number(q.discount)),
            taxRate: String(Number(q.taxRate)),
            dueDate: q.dueDate,
            submittedAt: q.submittedAt ?? "",
            terms: q.terms ?? "",
            notes: q.notes ?? "",
          }}
        />
      </div>
    </>
  );
}
