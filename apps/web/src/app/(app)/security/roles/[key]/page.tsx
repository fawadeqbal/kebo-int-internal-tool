import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Avatar, Badge, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import type { RoleDetail, RoleRow } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { deleteRoleAction, updateRoleAction } from "../../actions";
import { RoleForm } from "../../role-form";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const r = await load(() => api.get<RoleDetail>(`/roles/${encodeURIComponent(key)}`));
  return { title: `${r.name} · Security` };
}

/** One role: change what it allows and its two-step rule; who has it; remove it when nobody does. */
export default async function RolePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const me = await requireUser();
  const [r, roles] = await Promise.all([load(() => api.get<RoleDetail>(`/roles/${encodeURIComponent(key)}`)), api.get<RoleRow[]>("/roles")]);
  const superAdmin = !!roles.find((x) => x.key === me.role)?.superAdmin;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {r.name}
              {r.superAdmin ? <Badge tone="primary">Everything</Badge> : r.preset ? <Badge tone="outline">Built in</Badge> : null}
            </span>
          }
          description={r.key === me.role ? "This is your own role." : undefined}
        />
        <CardBody>
          <RoleForm action={updateRoleAction.bind(null, r.key)} role={r} mine={superAdmin ? null : me.permissions} isMine={r.key === me.role} submitLabel="Save the role" />
        </CardBody>
      </Card>
      <div className="flex flex-col gap-5">
        <Card className="overflow-hidden">
          <CardHeader title={`People in this role (${r.members.length})`} description="Change someone's role under Users." />
          {r.members.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Nobody yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {r.members.map((m) => (
                <li key={m.id}>
                  <Link href={`/users/${m.id}`} className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50", !m.isActive && "text-muted")}>
                    <Avatar name={m.name} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.name}</span>
                      <span className="block truncate text-xs text-muted">{m.isActive ? (m.lastLoginAt ? `Signed in ${timeAgo(m.lastLoginAt)}` : "Never signed in") : "Switched off"}</span>
                    </span>
                    {m.totpEnabledAt ? (
                      <ShieldCheck className="size-4 text-ok" aria-label="Uses two-step sign-in" />
                    ) : r.requireTwoStep && m.isActive ? (
                      <Badge tone="warn">Must set up</Badge>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {!r.preset && (
          <Card>
            <CardHeader title="Remove this role" />
            <CardBody className="flex flex-col gap-2">
              <p className="text-xs text-muted">{r.members.length ? "Give its people another role first (switched-off people count too)." : "Nobody has it, so it can go."}</p>
              <div>
                <ConfirmAction action={deleteRoleAction.bind(null, r.key)} confirm={`Remove the role ${r.name}?`} label="Remove the role" pendingText="Removing…" variant="danger-ghost" />
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
