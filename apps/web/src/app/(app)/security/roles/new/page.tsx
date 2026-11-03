import { redirect } from "next/navigation";
import { PlanOff } from "@/components/common/plan-off";
import { hasFeature } from "@/lib/session";

export const metadata = { title: "New role" };

/** A new role is made in the side panel over the roles (design system: one way to create); this address opens it. */
export default async function NewRolePage() {
  if (!(await hasFeature("custom_roles"))) return <PlanOff title="New role" what="Custom roles (beyond Super Admin, Manager and Staff)" />;
  redirect("/security?panel=new-role");
}
