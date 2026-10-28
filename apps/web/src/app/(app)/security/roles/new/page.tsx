import { Card, CardBody, CardHeader } from "@kebo/ui";
import { PlanOff } from "@/components/common/plan-off";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import type { RoleRow } from "@/lib/types-people";
import { createRoleAction } from "../../actions";
import { RoleForm } from "../../role-form";

export const metadata = { title: "New role" };

export default async function NewRolePage() {
  const me = await requireUser();
  if (!(await hasFeature("custom_roles"))) return <PlanOff title="New role" what="Custom roles (beyond Super Admin, Manager and Staff)" />;
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
