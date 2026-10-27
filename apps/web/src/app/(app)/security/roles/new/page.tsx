import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import type { RoleRow } from "@/lib/types-people";
import { createRoleAction } from "../../actions";
import { RoleForm } from "../../role-form";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  const me = await requireUser();
  const roles = await api.get<RoleRow[]>("/roles");
  const superAdmin = !!roles.find((r) => r.key === me.role)?.superAdmin;
  return (
    <Card>
      <CardHeader title="New role" description="Choose only what the job needs. You can change it later; people in the role get the change at once." />
      <CardBody>
        <RoleForm action={createRoleAction} mine={superAdmin ? null : me.permissions} submitLabel="Make the role" />
      </CardBody>
    </Card>
  );
}
