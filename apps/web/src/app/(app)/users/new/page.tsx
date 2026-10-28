import { Card, CardBody, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { hasFeature, requirePermission } from "@/lib/session";
import type { RoleRow } from "@/lib/types-people";
import { createUserAction } from "../actions";
import { NewUserForm } from "../forms";

export const metadata = { title: "Add a person" };

export default async function NewUserPage() {
  await requirePermission("users.manage");
  // Without custom roles (a plan feature) only the built-in roles can be given.
  const custom = await hasFeature("custom_roles");
  const roles = (await api.get<RoleRow[]>("/roles")).filter((r) => custom || r.preset);
  return (
    <div className="max-w-3xl">
      <PageHeader backHref="/users" backLabel="Users" title="Add a person" description="They can sign in as soon as you save. Choose the smallest role that lets them do their work." />
      <Card>
        <CardBody>
          <NewUserForm action={createUserAction} roles={roles} />
        </CardBody>
      </Card>
    </div>
  );
}
