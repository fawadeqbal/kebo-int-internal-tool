import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { listUsers } from "@/modules/users/repository";
import { ButtonLink, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  await requirePagePermission("users.manage");
  const users = await listUsers();
  return (
    <>
      <PageHeader title="Users" description="People who can sign in and what they are allowed to do." actions={<ButtonLink href="/users/new">Add user</ButtonLink>} />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-canvas/60">
                <Td>
                  <Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">
                    {u.name}
                  </Link>
                </Td>
                <Td className="text-muted">{u.email}</Td>
                <Td>{ROLE_LABELS[u.role]}</Td>
                <Td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Deactivated</Badge>}</Td>
                <Td className="text-muted">{formatDateTime(u.lastLoginAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
