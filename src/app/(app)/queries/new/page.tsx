import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { createQueryAction } from "@/modules/queries/actions";
import { QueryForm } from "@/modules/queries/components/query-form";
import { findCustomerFor } from "@/modules/customers/repository";
import { listActiveUsers } from "@/modules/users/repository";
import { PageHeader } from "@/components/ui";
import { getSettings } from "@/modules/settings/service";
import { listCategoriesInUse, mergeCategories } from "@/modules/queries/repository";

export const metadata = { title: "New inquiry" };

export default async function NewQueryPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePagePermission("queries.create");
  const { customer } = await searchParams;
  const [people, preselected, settings, usedCategories] = await Promise.all([listActiveUsers(), isUuid(customer) ? findCustomerFor(user, customer) : null, getSettings(), listCategoriesInUse()]);
  return (
    <>
      <PageHeader title="New inquiry" description="Who asked, which category, and what they need. Everything else is optional." backHref="/queries" backLabel="Inquiries" />
      <div className="max-w-4xl">
        <QueryForm
          mode="create"
          action={createQueryAction}
          people={people}
          canAssignOthers={can(user.role, "queries.assign")}
          currentUserId={user.id}
          cancelHref="/queries"
          initial={{ customer: preselected }}
          maxUploadMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}
          categories={settings.categories}
          otherCategories={mergeCategories(settings.categories, usedCategories).slice(settings.categories.length)}
        />
      </div>
    </>
  );
}
