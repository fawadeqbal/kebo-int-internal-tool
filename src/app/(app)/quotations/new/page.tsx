import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { NotFoundError } from "@/lib/utils/result";
import { quotationDraft } from "@/modules/documents/drafts";
import { createQuotationAction } from "@/modules/quotations/actions";
import { QuotationForm } from "@/modules/quotations/components";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ query?: string }> }) {
  const user = await requirePagePermission("quotations.manage");
  const { query: queryId } = await searchParams;
  if (!isUuid(queryId)) notFound();
  const draft = await quotationDraft(user, queryId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!draft) notFound();
  const { query, customer } = draft;
  return (
    <>
      <PageHeader
        title={draft.version > 1 ? `New version (v${draft.version})` : "New quotation"}
        description={
          <>
            For <span className="font-medium text-text">{customerName(customer)}</span> · {query.refNo}: {query.title}
            {draft.version > 1 ? " · starts from the latest version" : " · starts from the items the customer asked for"}
          </>
        }
        backHref={`/queries/${query.id}`}
        backLabel={query.refNo}
      />
      <div className="max-w-5xl">
        <QuotationForm
          action={createQuotationAction.bind(null, query.id)}
          currency={draft.currency}
          cancelHref={`/queries/${query.id}`}
          costing={can(user.role, "sourcing.manage")}
          submitLabel="Save as draft"
          initial={draft.initial}
        />
      </div>
    </>
  );
}
