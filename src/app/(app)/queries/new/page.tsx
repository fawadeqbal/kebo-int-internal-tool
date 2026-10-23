import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { createQueryAction } from "@/modules/queries/actions";
import { QueryForm } from "@/modules/queries/components/query-form";
import { findCustomer } from "@/modules/customers/repository";
import { listActiveUsers } from "@/modules/users/repository";
import { PageHeader } from "@/components/ui";
import { getSettings } from "@/modules/settings/service";

export const metadata = { title: "New query" };

export default async function NewQueryPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePagePermission("queries.create");
  const { customer } = await searchParams;
  const [people, preselected, settings] = await Promise.all([listActiveUsers(), isUuid(customer) ? findCustomer(customer) : null, getSettings()]);
  return (
    <>
      <PageHeader title="New query" description="Three things are needed: the customer, a category and what they asked for." backHref="/queries" backLabel="Queries" />
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
        />
      </div>
    </>
  );
}
