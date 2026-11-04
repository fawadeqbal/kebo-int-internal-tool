import Link from "next/link";
import { getCompany, hasFeature, requireUser } from "@/lib/session";
import { Plus } from "lucide-react";
import { PERMISSIONS, permissionInPlan } from "@kebo/shared";
import { Banner, Badge, Card, CardHeader, PageHeader, StatusBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { api } from "@/lib/api";
import type { RoleRow, SecurityOverview } from "@/lib/types-people";
import { Stat } from "@/components/common/stat";
import { OpenPanelButton } from "@/components/common/panel";
import { createRoleAction } from "../actions";
import { RolePanel } from "../role-form";

export const metadata = { title: "Roles" };

/** How people stand (signed in, two-step sign-in, failed attempts) and the roles: what each allows and whether it needs two-step sign-in. */
export default async function RolesPage() {
  const [o, roles, company, me, custom] = await Promise.all([
    api.get<SecurityOverview>("/security/overview"),
    api.get<RoleRow[]>("/roles"),
    getCompany(),
    requireUser(),
    hasFeature("custom_roles"),
  ]);
  const superAdmin = !!roles.find((x) => x.key === me.role)?.superAdmin;
  // Permissions follow the company's plan: what it leaves out nobody has, and it is not counted.
  const available = PERMISSIONS.filter((p) => permissionInPlan(p, company?.features ?? null)).length;
  const frozen = roles.filter((r) => r.frozen);
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/access/roles")} title="Roles" description="Who may do what, who must use two-step sign-in, and how people stand." />
      <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Signed in now" value={o.liveSessions} hint="Browsers and phones" href="/access/sessions" />
        <Stat
          label="Two-step sign-in"
          value={`${o.withTwoStep} of ${o.people}`}
          hint="Active people using it"
          tone={o.people && o.withTwoStep === o.people ? "ok" : undefined}
        />
        <Stat label="Failed sign-ins" value={o.failedLastDay} hint="In the last 24 hours" tone={o.failedLastDay >= 10 ? "bad" : o.failedLastDay ? "warn" : undefined} href="/access/sign-ins?failed=1" />
        <Stat label="Blocked addresses" value={o.blockedIpsLastDay} hint="Too many attempts, last 24 hours" tone={o.blockedIpsLastDay ? "bad" : undefined} href="/access/sign-ins?failed=1" />
      </div>

      {o.mustSetUp.length > 0 && (
        <Banner meaning="warn">
          <p className="font-medium">
            {o.mustSetUp.length === 1 ? "1 person has" : `${o.mustSetUp.length} people have`} not set up two-step sign-in yet, though their role needs it.
          </p>
          <p className="mt-0.5 text-text-2">
            They can only set it up at their next click; nothing else opens for them until they do:{" "}
            {o.mustSetUp.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link href={`/users/${p.id}`} className="font-medium underline-offset-2 hover:underline">
                  {p.name}
                </Link>{" "}
                ({p.role})
              </span>
            ))}
            .
          </p>
        </Banner>
      )}

      {frozen.length > 0 && (
        <Banner meaning="info">
          <p className="font-medium">
            {frozen.length === 1 ? `The role ${frozen[0]!.name} is` : `${frozen.length} roles your company made are`} frozen: your plan
            {company?.plan ? ` (${company.plan.name})` : ""} does not include custom roles.
          </p>
          <p className="mt-0.5 text-text-2">
            Their people keep working with what the plan includes. They cannot be changed or given to anyone else; move people to Super Admin, Manager or Staff, or ask for a
            plan with custom roles.
          </p>
        </Banner>
      )}

      <Card className="overflow-hidden p-0">
        <CardHeader
          title="Roles"
          description="Each person has one role. A change to a role applies to its people from their next click. The Super Admin always has everything."
          actions={
            // Roles beyond the three built in are a plan feature.
            custom && (
              <OpenPanelButton panel="new-role" variant="ghost" size="sm" className="h-8 px-2.5 text-[13px] [&_svg]:size-3.5">
                <Plus aria-hidden /> New role
              </OpenPanelButton>
            )
          }
        />
        <Table>
          <THead>
            <tr>
              <Th>Role</Th>
              <Th className="text-right">People</Th>
              <Th>Allows</Th>
              <Th>Two-step sign-in</Th>
            </tr>
          </THead>
          <tbody>
            {roles.map((r) => (
              <Tr key={r.key} className="hover:bg-surface-2/50">
                <Td className="max-w-md">
                  <Link href={`/access/roles/${r.key}`} className="group block">
                    <span className="flex items-center gap-2 font-medium group-hover:text-primary">
                      {r.name}
                      {r.superAdmin ? <Badge tone="primary">Everything</Badge> : r.preset ? <Badge tone="outline">Built in</Badge> : null}
                      {r.frozen && <StatusBadge meaning="warn">Frozen: not in your plan</StatusBadge>}
                    </span>
                    {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                  </Link>
                </Td>
                <Td className="text-right tabular">{r.people}</Td>
                <Td className="text-xs whitespace-nowrap text-text-2 tabular">
                  {r.superAdmin ? "Every permission" : `${r.permissions.length - r.notInPlan.length} of ${available} permissions`}
                  {r.notInPlan.length > 0 && <span className="block text-muted">+{r.notInPlan.length} kept for a bigger plan</span>}
                </Td>
                <Td>
                  {r.requireTwoStep ? (
                    <span className="inline-flex flex-col items-start gap-0.5">
                      <StatusBadge meaning={r.withoutTwoStep > 0 ? "warn" : "ok"}>Required</StatusBadge>
                      {r.withoutTwoStep > 0 && <span className="text-xs text-warn">{r.withoutTwoStep} still to set it up</span>}
                    </span>
                  ) : (
                    <span className="inline-flex flex-col items-start gap-0.5">
                      <StatusBadge meaning="neutral">Their choice</StatusBadge>
                      {r.people > 0 && <span className="text-xs text-muted">{`${r.people - r.withoutTwoStep} of ${r.people} use it`}</span>}
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {custom && (
        <RolePanel
          name="new-role"
          title="New role"
          description="Choose only what the job needs. You can change it later; people in the role get the change at once."
          action={createRoleAction}
          mine={superAdmin ? null : me.permissions}
          submitLabel="Make the role"
        />
      )}
      </div>
    </div>
  );
}
