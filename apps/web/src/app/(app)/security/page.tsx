import Link from "next/link";
import { hasFeature } from "@/lib/session";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { PERMISSIONS } from "@kebo/shared";
import { Alert, Badge, ButtonLink, Card, CardHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import type { RoleRow, SecurityOverview } from "@/lib/types-people";
import { Stat } from "@/components/common/stat";

export const metadata = { title: "Security · Roles" };

/** How people stand (signed in, two-step sign-in, failed attempts) and the roles: what each allows and whether it needs two-step sign-in. */
export default async function SecurityPage() {
  const [o, roles] = await Promise.all([api.get<SecurityOverview>("/security/overview"), api.get<RoleRow[]>("/roles")]);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Signed in now" value={o.liveSessions} hint="Browsers and phones" href="/security/sessions" />
        <Stat
          label="Two-step sign-in"
          value={`${o.withTwoStep} of ${o.people}`}
          hint="Active people using it"
          tone={o.people && o.withTwoStep === o.people ? "ok" : undefined}
        />
        <Stat label="Failed sign-ins" value={o.failedLastDay} hint="In the last 24 hours" tone={o.failedLastDay >= 10 ? "bad" : o.failedLastDay ? "warn" : undefined} href="/security/sign-ins?failed=1" />
        <Stat label="Blocked addresses" value={o.blockedIpsLastDay} hint="Too many attempts, last 24 hours" tone={o.blockedIpsLastDay ? "bad" : undefined} href="/security/sign-ins?failed=1" />
      </div>

      {o.mustSetUp.length > 0 && (
        <Alert tone="warning">
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
        </Alert>
      )}

      <Card className="overflow-hidden p-0">
        <CardHeader
          title="Roles"
          description="Each person has one role. A change to a role applies to its people from their next click. The Super Admin always has everything."
          actions={
            // Roles beyond the three built in are a plan feature.
            (await hasFeature("custom_roles")) && (
              <ButtonLink href="/security/roles/new" variant="primary" size="sm">
                New role
              </ButtonLink>
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
                  <Link href={`/security/roles/${r.key}`} className="group block">
                    <span className="flex items-center gap-2 font-medium group-hover:text-primary">
                      {r.name}
                      {r.superAdmin ? <Badge tone="primary">Everything</Badge> : r.preset ? <Badge tone="outline">Built in</Badge> : null}
                    </span>
                    {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                  </Link>
                </Td>
                <Td className="text-right tabular">{r.people}</Td>
                <Td className="text-xs whitespace-nowrap text-text-2 tabular">{r.superAdmin ? "Every permission" : `${r.permissions.length} of ${PERMISSIONS.length} permissions`}</Td>
                <Td>
                  {r.requireTwoStep ? (
                    <span className="inline-flex flex-col">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                        <ShieldCheck className="size-3.5" aria-hidden /> Required
                      </span>
                      {r.withoutTwoStep > 0 && <span className="text-xs text-warn">{r.withoutTwoStep} still to set it up</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <ShieldAlert className="size-3.5" aria-hidden /> Their choice{r.people ? ` (${r.people - r.withoutTwoStep} of ${r.people} use it)` : ""}
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
