import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, cn, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import type { UserRow } from "@/lib/types-people";
import { RoleBadge } from "@/components/people/role-badge";
import { TwoStepRemind } from "@/components/people/two-step-remind";
import { remindTwoStepAction } from "./actions";

export const metadata = { title: "Users" };

/** Everyone who can sign in: role, whether they are switched on, two-step sign-in and last sign-in. */
export default async function UsersPage() {
  const me = await requirePermission("users.manage");
  const users = await api.get<UserRow[]>("/users");
  const active = users.filter((u) => u.isActive).length;
  // People who sign in with a password only: those whose role requires two-step first.
  const without = users
    .filter((u) => u.isActive && !u.totpEnabledAt && u.id !== me.id)
    .sort((a, b) => Number(b.access.requireTwoStep) - Number(a.access.requireTwoStep) || a.name.localeCompare(b.name));
  return (
    <div>
      <PageHeader
        title="Users"
        description={`${active} ${active === 1 ? "person" : "people"} can sign in${users.length > active ? `, ${users.length - active} switched off` : ""}. Switch people off when they leave; their work stays.`}
        actions={<ButtonLink href="/users/new" variant="primary">Add a person</ButtonLink>}
      />
      {without.length > 0 && (
        <Card className="mb-5 border-warn/30 bg-warn-soft/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-warn">
            <ShieldAlert className="size-4" aria-hidden />
            {without.length === 1 ? "1 person signs in" : `${without.length} people sign in`} without two-step
          </p>
          <p className="mt-0.5 text-xs text-text-2">A stolen password is enough to get into their account. Ask them to turn it on: it takes two minutes with an authenticator app.</p>
          {(() => {
            const row = (u: (typeof without)[number]) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{u.name}</span> <span className="text-text-2">· {u.access.name}</span>
                  {u.access.requireTwoStep && <span className="block text-xs text-warn">Their role requires it: they are asked to set it up at their next sign-in.</span>}
                </span>
                <TwoStepRemind action={remindTwoStepAction.bind(null, u.id)} />
              </li>
            );
            return (
              <>
                <ul className="mt-3 flex flex-col divide-y divide-warn/20">{without.slice(0, 5).map(row)}</ul>
                {without.length > 5 && (
                  <details className="group">
                    <summary className="cursor-pointer py-2 text-sm font-medium text-primary">Show the other {without.length - 5}</summary>
                    <ul className="flex flex-col divide-y divide-warn/20">{without.slice(5).map(row)}</ul>
                  </details>
                )}
              </>
            );
          })()}
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <THead>
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th>Sign-in</Th>
              <Th>Two-step</Th>
              <Th className="text-right">Last signed in</Th>
            </tr>
          </THead>
          <tbody>
            {users.map((u) => (
              <Tr key={u.id} className={cn("hover:bg-surface-2/50", !u.isActive && "text-muted")}>
                <Td>
                  <Link href={`/users/${u.id}`} className="group flex items-center gap-3">
                    <Avatar name={u.name} size={30} className={cn(!u.isActive && "bg-surface-3 text-muted")} />
                    <span className="min-w-0">
                      <span className={cn("block font-medium group-hover:text-primary", !u.isActive && "text-text-2")}>
                        {u.name}
                        {u.id === me.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <RoleBadge name={u.access.name} superAdmin={u.access.superAdmin} />
                </Td>
                <Td>{u.isActive ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="outline">Switched off</Badge>}</Td>
                <Td>
                  {u.totpEnabledAt ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                      <ShieldCheck className="size-3.5" aria-hidden /> On
                    </span>
                  ) : u.access.requireTwoStep && u.isActive ? (
                    <span className="text-xs font-medium text-warn">Must set up</span>
                  ) : (
                    <span className="text-xs text-muted">Off</span>
                  )}
                </Td>
                <Td className="text-right text-xs whitespace-nowrap text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
