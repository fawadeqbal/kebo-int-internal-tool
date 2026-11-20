import Link from "next/link";
import { FACT_LABEL, FACT_VALUE, FACTS_GRID } from "@/components/common/record-box";
import { Pencil, ShieldCheck } from "lucide-react";
import { PERMISSION_GROUPS } from "@kebo/shared";
import { Avatar, Badge, Card, CardBody, CardHeader, cn, EmptyLine, PageHeader, StatusBadge, capsClass, Stack } from "@kebo/ui";
import { RecordBody } from "@/components/records/record-frame";
import { crumbsFor } from "@/lib/nav";
import { api } from "@/lib/api";
import { hasFeature, load, requireUser } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import type { RoleDetail, RoleRow } from "@/lib/types-people";
import { MoreMenu } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { deleteRoleAction, updateRoleAction } from "../../actions";
import { RolePanel } from "../../role-form";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const r = await load(() => api.get<RoleDetail>(`/roles/${encodeURIComponent(key)}`));
  return { title: `${r.name} · Roles` };
}


/**
 * One role (Settings frame): its details and what it allows, read-only, with
 * ✎ Edit for the side panel (?panel=edit-role); who has it; ⋯ Remove the role
 * (last, red, confirmed) when it is not built in.
 */
export default async function RolePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const me = await requireUser();
  const [r, roles, custom] = await Promise.all([load(() => api.get<RoleDetail>(`/roles/${encodeURIComponent(key)}`)), api.get<RoleRow[]>("/roles"), hasFeature("custom_roles")]);
  const superAdmin = !!roles.find((x) => x.key === me.role)?.superAdmin;
  const has = new Set(r.permissions);
  const edit = (
    <OpenPanelButton panel="edit-role" size="sm" label={`Edit the role ${r.name}`}>
      <Pencil aria-hidden /> Edit
    </OpenPanelButton>
  );
  const people = (
    <Card className="overflow-hidden">
        <CardHeader title={`People in this role (${r.members.length})`} description="Change someone's role under Users." />
        {r.members.length === 0 ? (
          <EmptyLine inset>Nobody yet. Give it to someone under Users.</EmptyLine>
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
                    <StatusBadge meaning="warn">Must set up</StatusBadge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
  );
  return (
    <Stack>
    {/* A record is titled by its name (the role's), with its kind beside it; the one record body below. */}
    <PageHeader
      crumbs={[...crumbsFor("/access/roles").slice(0, 1), { label: "Roles", href: "/access/roles" }, { label: r.name }]}
      title={r.name}
      record={{ kind: "Role" }}
      badge={r.superAdmin ? <Badge tone="primary">Everything</Badge> : r.preset ? <Badge tone="outline">Built in</Badge> : undefined}
    />
    <RecordBody panel={people} panelLabel="People in this role">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                Details
                {r.frozen && <StatusBadge meaning="warn">Frozen: not in your plan</StatusBadge>}
              </span>
            }
            keepRow
            description={r.key === me.role ? "This is your own role." : "What it is called, what it is for, and whether its people must use two-step sign-in."}
            actions={
              <>
                {edit}
                {!r.preset && (
                  <MoreMenu
                    label={`More for the role ${r.name}`}
                    items={[
                      {
                        label: "Remove the role…",
                        danger: true,
                        confirm: {
                          title: `Remove the role ${r.name}?`,
                          body: r.members.length
                            ? "Give its people another role first (switched-off people count too)."
                            : "Nobody has it, so it can go.",
                          confirmLabel: "Remove the role",
                        },
                        action: deleteRoleAction.bind(null, r.key),
                      },
                    ]}
                  />
                )}
              </>
            }
          />
          <CardBody>
            <dl className={FACTS_GRID}>
              <div className="contents">
                <dt className={FACT_LABEL}>Name</dt>
                <dd className={FACT_VALUE}>{r.name}</dd>
              </div>
              <div className="contents">
                <dt className={FACT_LABEL}>Two-step sign-in</dt>
                <dd className={FACT_VALUE}>
                  {r.requireTwoStep ? <StatusBadge meaning="ok">Required</StatusBadge> : <StatusBadge meaning="neutral">Their choice</StatusBadge>}
                </dd>
              </div>
              <div className="contents">
                <dt className={FACT_LABEL}>What it is for</dt>
                <dd className={FACT_VALUE}>
                  {r.description || (
                    <OpenPanelButton panel="edit-role" variant="link" className="font-medium no-underline hover:underline">
                      + Add
                    </OpenPanelButton>
                  )}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What people in this role may do"
            description={r.superAdmin ? "Every permission, including any added later." : `${r.permissions.length - r.notInPlan.length} permissions. A change applies to its people from their next click.`}
            keepRow
            actions={r.superAdmin ? undefined : edit}
          />
          <CardBody className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {PERMISSION_GROUPS.map((g) => {
              const allowed = g.items.filter((i) => r.superAdmin || has.has(i.permission));
              return (
                <div key={g.title} className="min-w-0">
                  <p className={capsClass}>
                    {g.title} <span className="font-normal tabular">{allowed.length}/{g.items.length}</span>
                  </p>
                  {allowed.length ? (
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      {allowed.map((i) => (
                        <li key={i.permission} className="flex items-start gap-1.5">
                          <span aria-hidden className="text-ok">
                            ✓
                          </span>
                          {i.label}
                          {r.notInPlan.includes(i.permission) && <span className="text-xs text-warn">(not in your plan)</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">Nothing here</p>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>


      <RolePanel
        name="edit-role"
        title={`Edit role · ${r.name}`}
        description="People in this role get the change from their next click."
        action={updateRoleAction.bind(null, r.key)}
        role={r}
        mine={superAdmin ? null : me.permissions}
        isMine={r.key === me.role}
        locked={!custom}
        submitLabel="Save the role"
      />
    </RecordBody>
    </Stack>
  );
}

