import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus, SearchX } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { listUsers } from "@/modules/users/repository";
import { ActiveFilters, Avatar, ButtonLink, EmptyState, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { FilterSelect, FilterToolbar } from "@/components/ui/filters";
import { Badge } from "@/components/ui/badge";
import { buildHref } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Users" };

const ROLE_TONE = { admin: "primary", manager: "info", staff: "neutral" } as const;
const STATES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
];

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="ok" dot>
      Active
    </Badge>
  ) : (
    <Badge dot>Deactivated</Badge>
  );
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("users.manage");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase().slice(0, 100) || undefined;
  const role = sp.role && sp.role in ROLE_LABELS ? (sp.role as keyof typeof ROLE_LABELS) : undefined;
  const state = STATES.some((s) => s.value === sp.state) ? sp.state : undefined;
  const all = await listUsers();
  const users = all.filter(
    (u) => (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) && (!role || u.role === role) && (!state || (state === "active") === u.isActive),
  );
  const params = { q, role, state };
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/users", params, patch);
  const active = [role && { key: "role", label: "Role", value: ROLE_LABELS[role] }, state && { key: "state", label: "Status", value: STATES.find((s) => s.value === state)!.label }].filter(Boolean) as {
    key: string;
    label: string;
    value: string;
  }[];

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
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <FilterToolbar
          activeCount={active.length}
          search={<SearchField defaultValue={q} placeholder="Name or email" clearHref={hrefFor({ q: undefined })} label="Search users" />}
          end={
            <>
              {active.length > 0 && (
                <Link href={buildHref("/users", { q }, {})} className="font-medium text-muted hover:text-text">
                  Reset
                </Link>
              )}
              <span>
                {users.length} of {all.length} users
              </span>
            </>
          }
        >
          <FilterSelect name="role" label="Role" value={role} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} allLabel="All" />
          <FilterSelect name="state" label="Status" value={state} options={STATES} allLabel="All" />
        </FilterToolbar>
        <ActiveFilters clearHref={buildHref("/users", { q }, {})} items={active.map((a) => ({ ...a, removeHref: hrefFor({ [a.key]: undefined }) }))} />

        {users.length === 0 ? (
          <EmptyState icon={SearchX} title="No users match" description="Try another name, or remove a filter." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Last sign-in</Th>
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
                        <StatusBadge active={u.isActive} />
                      </Td>
                      <Td className="whitespace-nowrap text-muted">{formatDateTime(u.lastLoginAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {users.map((u) => (
                <li key={u.id}>
                  <Link href={`/users/${u.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <Avatar name={u.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{u.name}</span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                      <span className="mt-1.5 flex gap-1.5">
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                        <StatusBadge active={u.isActive} />
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
