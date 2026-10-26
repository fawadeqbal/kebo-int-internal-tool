import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { updateQueryAction } from "@/modules/queries/actions";
import { QueryForm } from "@/modules/queries/components/query-form";
import { getQueryDetail } from "@/modules/queries/repository";
import { canWorkOn } from "@/modules/queries/service";
import { toEditableLine } from "@/lib/line-items";
import { PageHeader } from "@/components/ui";
import { getSettings } from "@/modules/settings/service";
import { listCategoriesInUse, mergeCategories } from "@/modules/queries/repository";

export const metadata = { title: "Edit inquiry" };

export default async function EditQueryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = isUuid(id) ? await getQueryDetail(user, id) : null;
  if (!detail) notFound();
  if (!canWorkOn(user, detail.query)) redirect("/forbidden");
  const { query, customer } = detail;
  const [settings, usedCategories] = await Promise.all([getSettings(), listCategoriesInUse()]);
  return (
    <>
      <PageHeader title={`Edit ${query.refNo}`} backHref={`/queries/${id}`} backLabel={query.refNo} />
      <div className="max-w-4xl">
        <QueryForm
          mode="edit"
          action={updateQueryAction.bind(null, id)}
          cancelHref={`/queries/${id}`}
          maxUploadMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}
          categories={settings.categories}
          otherCategories={mergeCategories(settings.categories, usedCategories).slice(settings.categories.length)}
          initial={{
            customer: { id: customer.id, companyName: customer.companyName, contactPerson: customer.contactPerson, phone: customer.phone, email: customer.email },
            source: query.source,
            title: query.title,
            category: query.category,
            items: detail.items.map((i) => toEditableLine(i, { keepId: true, withPrice: false })),
            specifications: query.specifications,
            priority: query.priority,
            requiredBy: query.requiredBy,
          }}
        />
      </div>
    </>
  );
}
