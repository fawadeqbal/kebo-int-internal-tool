import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { listUsers } from "@/modules/users/repository";
import { Avatar, ButtonLink, Card, PageHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Users" };

const ROLE_TONE = { admin: "primary", manager: "info", staff: "neutral" } as const;

export default async function UsersPage() {
  await requirePagePermission("users.manage");
  const users = await listUsers();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="People who can sign in and what they are allowed to do."
        actions={
          <ButtonLink href="/users/new" variant="primary" size="sm">
            <Plus aria-hidden /> Add user
          </ButtonLink>
        }
      />
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Last sign-in</Th>
            </tr>
          </THead>
          <tbody>
            {users.map((u) => (
              <Tr key={u.id} className="group relative hover:bg-surface-2/70">
                <Td className="py-2">
                  <Link href={`/users/${u.id}`} className="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 after:content-['']">
                    <Avatar name={u.name} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text group-hover:text-primary">{u.name}</span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                </Td>
                <Td>
                  {u.isActive ? (
                    <Badge tone="ok" dot>
                      Active
                    </Badge>
                  ) : (
                    <Badge dot>Deactivated</Badge>
                  )}
                </Td>
                <Td className="hidden whitespace-nowrap text-muted md:table-cell">{formatDateTime(u.lastLoginAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
