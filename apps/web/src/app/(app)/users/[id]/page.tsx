import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@kebo/shared";
import { ShieldCheck } from "lucide-react";
import { Avatar, Badge, Card, CardBody, CardHeader, DetailList, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { hasFeature, requirePermission } from "@/lib/session";
import { dateTime } from "@/lib/format";
import type { RoleRow, UserRow } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { RoleBadge } from "@/components/people/role-badge";
import { resetTwoStepAction, setActiveAction, setPasswordAction, updateUserAction } from "../actions";
import { EditUserForm, SetPasswordForm } from "../forms";

export const metadata = { title: "Person" };

/** One person: details and role, a new password, switch on/off, reset two-step sign-in. */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("users.manage");
  const [users, all, custom] = await Promise.all([api.get<UserRow[]>("/users"), api.get<RoleRow[]>("/roles"), hasFeature("custom_roles")]);
  const u = users.find((x) => x.id === id);
  if (!u) notFound();
  // Without custom roles (a plan feature) only the built-in roles can be given; the person's own stays listed.
  const roles = all.filter((r) => custom || r.preset || r.key === u.role);
  const isMe = u.id === me.id;
  return (
    <div className="max-w-4xl">
      <PageHeader
        backHref="/users"
        backLabel="Users"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <Avatar name={u.name} size={32} />
            {u.name}
            <RoleBadge name={u.access.name} superAdmin={u.access.superAdmin} />
            {!u.isActive && <Badge tone="outline">Switched off</Badge>}
          </span>
        }
        description={isMe ? "This is you. Change your own password and two-step sign-in under My account." : u.email}
      />
      <div className="grid items-start gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Details" description="Name, sign-in email and what they may do" />
          <CardBody>
            <EditUserForm action={updateUserAction.bind(null, u.id)} user={u} roles={roles} isMe={isMe} />
          </CardBody>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Sign-in" />
            <CardBody className="flex flex-col gap-4">
              <DetailList
                columns={2}
                items={[
                  { label: "Status", value: u.isActive ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="outline">Switched off</Badge> },
                  { label: "Last signed in", value: u.lastLoginAt ? dateTime(u.lastLoginAt) : "Never" },
                  {
                    label: "Two-step sign-in",
                    value: u.totpEnabledAt ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <ShieldCheck className="size-4" aria-hidden /> On since {dateTime(u.totpEnabledAt)}
                      </span>
                    ) : u.access.requireTwoStep ? (
                      <span className="text-warn">Off: their role needs it, so they set it up at their next sign-in</span>
                    ) : (
                      "Off"
                    ),
                  },
                  { label: "Added", value: dateTime(u.createdAt) },
                ]}
              />
              {can(me, "security.manage") && (
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <Link href={`/security/sessions?person=${u.id}`} className="font-medium text-primary hover:underline">
                    Where they are signed in
                  </Link>
                  <Link href={`/security/sign-ins?person=${u.id}`} className="font-medium text-primary hover:underline">
                    Their sign-in history
                  </Link>
                </p>
              )}
              {!isMe && (
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  {u.isActive ? (
                    <div>
                      <p className="mb-2 text-xs text-muted">They stop being able to sign in and are signed out everywhere. Their inquiries and history stay.</p>
                      <ConfirmAction action={setActiveAction.bind(null, u.id, false)} confirm={`Switch off ${u.name}? They will be signed out everywhere.`} label="Switch off" pendingText="Switching off…" variant="danger" />
                    </div>
                  ) : (
                    <div>
                      <p className="mb-2 text-xs text-muted">They can sign in again with their current password.</p>
                      <ConfirmAction action={setActiveAction.bind(null, u.id, true)} confirm={`Switch ${u.name} back on?`} label="Switch on" pendingText="Switching on…" variant="primary" />
                    </div>
                  )}
                  {u.totpEnabledAt && (
                    <div>
                      <p className="mb-2 text-xs text-muted">Only when they lost their phone and their recovery codes. They sign in with just their password until they set it up again.</p>
                      <ConfirmAction action={resetTwoStepAction.bind(null, u.id)} confirm={`Turn off two-step sign-in for ${u.name}? They will be signed out everywhere.`} label="Reset two-step sign-in" pendingText="Resetting…" variant="secondary" />
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
          {!isMe && (
            <Card>
              <CardHeader title="Set a new password" description="For when they forgot theirs. They are signed out everywhere and use this one next time." />
              <CardBody>
                <SetPasswordForm action={setPasswordAction.bind(null, u.id)} />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
