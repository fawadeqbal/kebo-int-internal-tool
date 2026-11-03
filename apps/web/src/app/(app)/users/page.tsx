import Link from "next/link";
import { Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { Avatar, buildHref, ButtonLink, Card, cn, DataRow, EmptyState, ListToolbar, PAGE_SIZE, PageHeader, Pager, PhoneList, PhoneRow, StatusBadge, Td, Th, THead, toPage } from "@kebo/ui";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import type { UserRow } from "@/lib/types-people";
import { RoleBadge } from "@/components/people/role-badge";
import { TwoStepRemind } from "@/components/people/two-step-remind";
import { remindTwoStepAction, setActiveAction } from "./actions";

export const metadata = { title: "Users" };

type Params = Record<string, string | undefined>;

const SHOWS = ["all", "active", "off", "no-two-step"] as const;
type Show = (typeof SHOWS)[number];
const SHOW_CHIP: Record<Show, string> = { all: "All", active: "Can sign in", off: "Switched off", "no-two-step": "Without two-step" };
const shows: Record<Show, (u: UserRow) => boolean> = {
  all: () => true,
  active: (u) => u.isActive,
  off: (u) => !u.isActive,
  "no-two-step": (u) => u.isActive && !u.totpEnabledAt,
};

/**
 * Users (design system: List frame): everyone who can sign in, their role,
 * whether they are switched on, two-step sign-in and last sign-in. Add a
 * person is the one primary (its own page for now); search and a chip per
 * state with its count in one row; rows open the person, ⋯ at the end; 25 a
 * page, every filter in the URL. A company has tens of people, so the whole
 * list is read and filtered here.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requirePermission("users.manage");
  const sp = await searchParams;
  const users = await api.get<UserRow[]>("/users");
  const active = users.filter((u) => u.isActive).length;
  const show: Show = SHOWS.includes(sp.show as Show) ? (sp.show as Show) : "all";
  const term = sp.q?.trim().toLowerCase();
  const found = term ? users.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)) : users;
  const rows = found.filter(shows[show]);
  const page = Math.min(toPage(sp.page), Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const keep = { q: sp.q, show: show === "all" ? undefined : show };
  const href = (patch: Params) => buildHref("/users", keep, { page: undefined, ...patch });
  const chips = SHOWS.filter((s) => s === "all" || s === show || found.some(shows[s])).map((s) => ({
    key: s,
    label: SHOW_CHIP[s],
    count: found.filter(shows[s]).length,
    href: href({ show: s === "all" ? undefined : s }),
    active: show === s,
  }));
  const rowMenu = (u: UserRow): MenuEntry[] => [
    { label: "Open", href: `/users/${u.id}` },
    { label: "Copy link", copy: `/users/${u.id}` },
    ...(u.isActive && u.id !== me.id
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
  // People who sign in with a password only: those whose role requires two-step first.
  const without = users
    .filter((u) => u.isActive && !u.totpEnabledAt && u.id !== me.id)
    .sort((a, b) => Number(b.access.requireTwoStep) - Number(a.access.requireTwoStep) || a.name.localeCompare(b.name));
  return (
    <div>
      <PageHeader
        title="Users"
        summary={
          <>
            {active} {active === 1 ? "person" : "people"} can sign in{users.length > active ? ` · ${users.length - active} switched off` : ""}
            <span className="max-sm:hidden"> · switch people off when they leave; their work stays</span>
          </>
        }
        primary={
          <ButtonLink href="/users/new" variant="primary">
            <Plus aria-hidden /> <span className="sm:hidden">Add</span>
            <span className="max-sm:hidden">Add a person</span>
          </ButtonLink>
        }
      />
      {without.length > 0 && (
        <Card className="mb-4 border-warn/30 bg-warn-soft/40 px-4 py-3">
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
              <details className="group mt-1">
                <summary className="cursor-pointer py-1 text-sm font-medium text-primary">
                  <span className="group-open:hidden">Show them and send a reminder</span>
                  <span className="hidden group-open:inline">Hide them</span>
                </summary>
                <ul className="mt-1 flex flex-col divide-y divide-warn/20">{without.map(row)}</ul>
              </details>
            );
          })()}
        </Card>
      )}
      <ListToolbar search={{ placeholder: "Search name or email…", value: sp.q, clearHref: href({ q: undefined }) }} keep={keep} chips={chips} label="Filter users" />

      <Card className="overflow-clip p-0">
        {rows.length === 0 ? (
          <EmptyState
            framed
            title="No people match these filters"
            description="Try part of the name or the email, or clear the filters."
            action={
              <ButtonLink href="/users" size="sm">
                Clear filters
              </ButtonLink>
            }
          />
        ) : (
          <>
            <PhoneList label="Users">
              {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((u) => (
                <PhoneRow
                  key={u.id}
                  href={`/users/${u.id}`}
                  title={`${u.name}${u.id === me.id ? " (you)" : ""}`}
                  line={`${u.access.name} · ${u.email}`}
                  muted={!u.isActive}
                  status={u.isActive ? <StatusBadge meaning="ok">Active</StatusBadge> : <StatusBadge meaning="neutral">Switched off</StatusBadge>}
                  figure={u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never signed in"}
                />
              ))}
            </PhoneList>
            <DataTable label="Users" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Two-step</Th>
                  <Th className="text-right">Last signed in</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((u) => (
                  <DataRow key={u.id} href={`/users/${u.id}`} className={cn(!u.isActive && "text-text-2")}>
                    <Td>
                      <span className="flex items-center gap-3">
                        <Avatar name={u.name} size={30} className={cn(!u.isActive && "bg-surface-3 text-muted")} />
                        <span className="min-w-0">
                          <Link href={`/users/${u.id}`} className={cn("block font-semibold hover:text-primary", !u.isActive && "text-text-2")}>
                            {u.name}
                            {u.id === me.id && <span className="ml-1.5 text-xs font-normal text-text-2">(you)</span>}
                          </Link>
                          <span className="block truncate text-xs text-text-2">{u.email}</span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <RoleBadge name={u.access.name} superAdmin={u.access.superAdmin} />
                    </Td>
                    <Td>{u.isActive ? <StatusBadge meaning="ok">Active</StatusBadge> : <StatusBadge meaning="neutral">Switched off</StatusBadge>}</Td>
                    <Td>
                      {u.totpEnabledAt ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                          <ShieldCheck className="size-3.5" aria-hidden /> On
                        </span>
                      ) : u.access.requireTwoStep && u.isActive ? (
                        <StatusBadge meaning="warn">Must set up</StatusBadge>
                      ) : (
                        <span className="text-xs text-text-2">Off</span>
                      )}
                    </Td>
                    <Td className="text-right text-xs whitespace-nowrap text-text-2">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</Td>
                    <Td className="text-right">
                      <RowMenu items={rowMenu(u)} label={`Actions for ${u.name}`} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/users" params={keep} page={page} total={rows.length} />
      </Card>
    </div>
  );
}
