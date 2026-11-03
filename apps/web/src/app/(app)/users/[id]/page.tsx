import { notFound } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { can } from "@kebo/shared";
import { Avatar, PageHeader, StageBadge, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { hasFeature, requirePermission } from "@/lib/session";
import { date, dateTime, timeAgo } from "@/lib/format";
import type { DealRow, HistoryEntry, Paged } from "@/lib/types";
import type { AuditRow, RoleRow, UserRow } from "@/lib/types-people";
import { MoreMenu, RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { AllLink, DetailsCard, RecordEmpty, RecordFrame, RecordListCard, RecordRow, RecordSection } from "@/components/common/record";
import { RecordLanding, RecordNav } from "@/components/common/record-nav";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { changeRows, compactChanges } from "@/components/orders/side-panel";
import { RoleBadge } from "@/components/people/role-badge";
import { PerformanceCard } from "@/components/insights/performance";
import { resetTwoStepAction, setActiveAction, setPasswordAction, updateUserAction } from "../actions";
import { EditUserPanel, PasswordPanel } from "../forms";

export const metadata = { title: "Person" };

/** Inquiries the card shows before "All n". */
const ROWS = 6;

/** An audit row as a history entry (for the Changes lines). */
const asHistory = (r: AuditRow): HistoryEntry => ({
  id: r.id,
  at: r.createdAt,
  by: r.userId ? { id: r.userId, name: r.userName } : null,
  action: r.action,
  entityType: r.entityType,
  summary: r.summary,
  reason: null,
  changes: [],
});

/**
 * One person (design system: Record frame). Header: ← Users, the name, Active
 * or Switched off, role · email · last sign-in; no primary (nothing is
 * "next" for a person) — Set a new password is the secondary, ⋯ has the rest
 * (switch off last, red). Main column: Performance (Insights),
 * Details with ✎ Edit (side panel: name, email, role), the open inquiries
 * they handle; right panel: changes to their account (with the audit log).
 */
export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requirePermission("users.manage");
  const seeAudit = can(me, "audit.view") && (await hasFeature("audit_log"));
  const [users, all, inquiries, audit] = await Promise.all([
    api.get<UserRow[]>("/users"),
    api.get<RoleRow[]>("/roles"),
    api.get<Paged<DealRow>>("/inquiries", { assignee: id, stage: "open", pageSize: ROWS }).catch(() => null),
    seeAudit ? api.get<Paged<AuditRow>>("/audit", { entityType: "user", entityId: id, pageSize: 50 }).catch(() => null) : null,
  ]);
  const u = users.find((x) => x.id === id);
  if (!u) notFound();
  // Frozen roles (custom roles, not in the company's plan) cannot be given; the person's own stays listed.
  const roles = all.filter((r) => !r.frozen || r.key === u.role);
  const isMe = u.id === me.id;
  const changes = audit ? compactChanges(audit.rows.map(asHistory)) : null;

  const twoStep = u.totpEnabledAt ? (
    <span className="inline-flex items-center gap-1 text-ok">
      <ShieldCheck className="size-4" aria-hidden /> On since {date(u.totpEnabledAt)}
    </span>
  ) : u.access.requireTwoStep ? (
    <span className="text-warn">Off — their role needs it, so they set it up at their next sign-in</span>
  ) : (
    "Off"
  );

  const more: MenuEntry[] = [
    ...(can(me, "security.manage")
      ? [
          { label: "Where they are signed in", href: `/security/sessions?person=${u.id}` },
          { label: "Their sign-in history", href: `/security/sign-ins?person=${u.id}` },
        ]
      : []),
    ...(seeAudit ? [{ label: "What they did (audit log)", href: `/audit?person=${u.id}` }] : []),
    { label: "Copy link", copy: `/users/${u.id}` },
    ...(!isMe && u.totpEnabledAt
      ? [
          {
            label: "Reset two-step sign-in…",
            confirm: {
              title: `Turn off two-step sign-in for ${u.name}?`,
              body: "Only when they lost their phone and their recovery codes. They are signed out everywhere and sign in with just their password until they set it up again.",
              confirmLabel: "Reset two-step",
            },
            action: resetTwoStepAction.bind(null, u.id),
          },
        ]
      : []),
    ...(!isMe && !u.isActive
      ? [
          {
            label: "Switch on…",
            confirm: { title: `Switch ${u.name} back on?`, body: "They can sign in again with their current password.", confirmLabel: "Switch on" },
            action: setActiveAction.bind(null, u.id, true),
          },
        ]
      : []),
    ...(!isMe && u.isActive
      ? [
          { separator: true as const },
          {
            label: "Switch off…",
            danger: true as const,
            confirm: { title: `Switch off ${u.name}?`, body: "They stop being able to sign in and are signed out everywhere. Their inquiries and history stay.", confirmLabel: "Switch off" },
            action: setActiveAction.bind(null, u.id, false),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        backHref="/users"
        backLabel="Users"
        phoneStack
        title={
          <span className="flex items-center gap-2.5">
            <Avatar name={u.name} size={32} />
            {u.name}
          </span>
        }
        badge={
          <>
            {u.isActive ? <StatusBadge meaning="ok">Active</StatusBadge> : <StatusBadge meaning="neutral">Switched off</StatusBadge>}
            <RoleBadge name={u.access.name} superAdmin={u.access.superAdmin} />
          </>
        }
        summary={
          <>
            <span className="break-all">{u.email}</span> · {u.lastLoginAt ? `last signed in ${timeAgo(u.lastLoginAt)}` : "never signed in"}
            {isMe && <span className="block text-muted">This is you: change your own password and two-step sign-in under My account.</span>}
          </>
        }
        papers={
          !isMe && (
            <OpenPanelButton panel="user-password" size="md">
              <KeyRound aria-hidden /> Set a new password
            </OpenPanelButton>
          )
        }
        more={<MoreMenu items={more} phoneItems={isMe ? [] : [{ label: "Set a new password", panel: "user-password" }]} label={`More for ${u.name}`} />}
      />
      <RecordLanding />

      <RecordFrame
        sideLabel="Changes"
        nav={
          <RecordNav
            label="Person sections"
            items={[
              { id: "overview", label: "Overview" },
              ...(inquiries ? [{ id: "inquiries", label: "Inquiries", count: inquiries.total }] : []),
              ...(changes ? [{ id: "changes", label: "Changes", count: changes.length }] : []),
            ]}
          />
        }
        main={
          <>
            <RecordSection id="overview" className="flex flex-col gap-5">
              <PerformanceCard kind="user" id={u.id} me={me} />
              <DetailsCard
                flash={sp.saved === u.id}
                edit={{ panel: "edit-user", id: u.id, label: `Edit ${u.name}` }}
                description="Name, sign-in email and what they may do · click a value or Edit"
                items={[
                  { label: "Name", value: u.name },
                  { label: "Sign-in email", value: <span className="break-all">{u.email}</span> },
                  { label: "Role", value: u.access.name },
                  { label: "Two-step sign-in", value: twoStep, readOnly: true },
                  { label: "Last signed in", value: u.lastLoginAt ? dateTime(u.lastLoginAt) : "Never", readOnly: true },
                  { label: "Added", value: date(u.createdAt), readOnly: true },
                ]}
              />
            </RecordSection>

            {inquiries && (
              <RecordSection id="inquiries">
                <RecordListCard
                  title="Open inquiries they handle"
                  count={inquiries.total}
                  description={inquiries.total ? "New, sourcing and quoted, newest first" : undefined}
                  action={inquiries.total > ROWS && <AllLink href={`/inquiries?assignee=${u.id}`}>All {inquiries.total}</AllLink>}
                  empty={
                    <RecordEmpty title="No open inquiries">
                      Inquiries they handle show here while they are open. Choose them under &ldquo;Handled by&rdquo; on an inquiry.
                    </RecordEmpty>
                  }
                >
                  {inquiries.rows.map((d) => (
                    <RecordRow
                      key={d.id}
                      href={`/inquiries/${d.id}`}
                      title={d.refNo}
                      sub={`${d.customer.name} · ${d.title}`}
                      status={<StageBadge stage={d.stage} onHold={d.onHold} />}
                      figure={<span className="text-xs text-text-2">{date(d.createdAt)}</span>}
                      menu={
                        <RowMenu
                          label={`Actions for ${d.refNo}`}
                          items={[
                            { label: "Open", href: `/inquiries/${d.id}` },
                            { label: "Copy link", copy: `/inquiries/${d.id}` },
                          ]}
                        />
                      }
                    />
                  ))}
                </RecordListCard>
              </RecordSection>
            )}
          </>
        }
        side={
          changes && (
            <SidePanelCard label="Changes">
              <div id="changes" className="scroll-mt-32">
                <SideSection
                  title="Changes"
                  count={changes.length}
                  dense
                  action={
<AllLink href={`/audit?person=${u.id}`}>What they did</AllLink>
                  }
                  empty="Nothing changed on their account yet."
                >
                  {changeRows(changes)}
                </SideSection>
              </div>
            </SidePanelCard>
          )
        }
      />

      {sp.panel === "edit-user" && <EditUserPanel action={updateUserAction.bind(null, u.id)} user={u} roles={roles} isMe={isMe} />}
      {sp.panel === "user-password" && !isMe && <PasswordPanel action={setPasswordAction.bind(null, u.id)} name={u.name} />}
    </div>
  );
}
