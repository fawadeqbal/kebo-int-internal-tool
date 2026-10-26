import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, cn, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import type { UserRow } from "@/lib/types-people";
import { RoleBadge } from "@/components/people/role-badge";

export const metadata = { title: "Users" };

/** Everyone who can sign in: role, whether they are switched on, two-step sign-in and last sign-in. */
export default async function UsersPage() {
  const me = await requirePermission("users.manage");
  const users = await api.get<UserRow[]>("/users");
  const active = users.filter((u) => u.isActive).length;
  return (
    <div>
      <PageHeader
        title="Users"
        description={`${active} ${active === 1 ? "person" : "people"} can sign in${users.length > active ? `, ${users.length - active} switched off` : ""}. Switch people off when they leave; their work stays.`}
        actions={<ButtonLink href="/users/new" variant="primary">Add a person</ButtonLink>}
      />
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
                  <RoleBadge role={u.role} />
                </Td>
                <Td>{u.isActive ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="outline">Switched off</Badge>}</Td>
                <Td>
                  {u.totpEnabledAt ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                      <ShieldCheck className="size-3.5" aria-hidden /> On
                    </span>
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
