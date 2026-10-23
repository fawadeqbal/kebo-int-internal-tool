import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { updateQueryAction } from "@/modules/queries/actions";
import { QueryForm } from "@/modules/queries/components/query-form";
import { getQueryDetail } from "@/modules/queries/repository";
import { canWorkOn } from "@/modules/queries/service";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit query" };

export default async function EditQueryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = isUuid(id) ? await getQueryDetail(user, id) : null;
  if (!detail) notFound();
  if (!canWorkOn(user, detail.query)) redirect("/forbidden");
  const { query, customer } = detail;
  return (
    <>
      <PageHeader title={`Edit ${query.refNo}`} backHref={`/queries/${id}`} backLabel={query.refNo} />
      <div className="max-w-4xl">
        <QueryForm
          mode="edit"
          action={updateQueryAction.bind(null, id)}
          cancelHref={`/queries/${id}`}
          maxUploadMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}
          initial={{
            customer: { id: customer.id, companyName: customer.companyName, contactPerson: customer.contactPerson, phone: customer.phone, email: customer.email },
            source: query.source,
            title: query.title,
            category: query.category,
            specifications: query.specifications,
            quantity: query.quantity,
            priority: query.priority,
            requiredBy: query.requiredBy,
          }}
        />
      </div>
    </>
  );
}
