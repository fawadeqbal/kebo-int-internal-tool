import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { getQueryDetail } from "@/modules/queries/repository";
import { createQuotationAction } from "@/modules/quotations/actions";
import { QuotationForm } from "@/modules/quotations/components";
import { getSettings } from "@/modules/settings/service";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ query?: string }> }) {
  const user = await requirePagePermission("quotations.manage");
  const { query: queryId } = await searchParams;
  const detail = isUuid(queryId) ? await getQueryDetail(user, queryId) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const { query, customer } = detail;
  return (
    <>
      <PageHeader
        title="New quotation"
        description={
          <>
            For <span className="font-medium text-ink">{customerName(customer)}</span> · {query.refNo}: {query.title}
            {detail.quotations.length > 0 && ` · this will be version ${detail.quotations.length + 1}`}
          </>
        }
        backHref={`/queries/${query.id}`}
        backLabel={query.refNo}
      />
      <div className="max-w-5xl">
        <QuotationForm
          action={createQuotationAction.bind(null, query.id)}
          currency={settings.currency}
          cancelHref={`/queries/${query.id}`}
          submitLabel="Save as draft"
          initial={{
            items: [{ description: query.title, quantity: String(query.quantity), unitPrice: "" }],
            discount: "0",
            taxRate: String(settings.defaultTaxRate),
            dueDate: addDaysISO(todayISO(), settings.quotationValidityDays),
            submittedAt: "",
            terms: settings.defaultQuotationTerms,
            notes: "",
          }}
        />
      </div>
    </>
  );
}
