import Link from "next/link";
import { ScrollText, SearchX } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listAudit } from "@/modules/audit/repository";
import { listUsers } from "@/modules/users/repository";
import { ActiveFilters, Avatar, EmptyState, PageHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { FilterDates, FilterSelect, FilterToolbar } from "@/components/ui/filters";
import { Badge } from "@/components/ui/badge";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { isUuid } from "@/lib/utils/ids";

export const metadata = { title: "Audit log" };

const ENTITY_TYPES = ["query", "customer", "quotation", "invoice", "payment", "attachment", "user", "settings"];
const ENTITY_LABEL: Record<string, string> = { query: "Inquiry" };
const label = (t: string) => ENTITY_LABEL[t] ?? t[0].toUpperCase() + t.slice(1);
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

function Changes({ oldValues, newValues }: { oldValues: unknown; newValues: unknown }) {
  const n = (newValues ?? {}) as Record<string, unknown>;
  const o = (oldValues ?? {}) as Record<string, unknown>;
  const keys = Object.keys(n);
  if (keys.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs break-words text-muted">
      {keys.slice(0, 6).map((k) => (
        <li key={k}>
          <span className="font-mono text-[11px] text-text-2">{k}</span>: {k in o ? <s className="mr-1">{String(o[k] ?? "—").slice(0, 60)}</s> : null}
          {String(n[k] ?? "—").slice(0, 80)}
        </li>
      ))}
    </ul>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const type = ENTITY_TYPES.includes(sp.type ?? "") ? sp.type : undefined;
  const who = isUuid(sp.who) ? sp.who : undefined;
  const from = isDate(sp.from);
  const to = isDate(sp.to);
  const [data, people] = await Promise.all([listAudit({ page: toPage(sp.page), entityType: type, userId: who, from, to }), listUsers()]);
  const params = { type, who, from, to };
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/audit", params, { page: undefined, ...patch });
  const active = [
    type && { key: "type", label: "Record", value: label(type) },
    who && { key: "who", label: "Person", value: people.find((p) => p.id === who)?.name ?? "Someone" },
    (from || to) && { key: "dates", label: "When", value: `${from ? formatDate(from) : "…"} – ${to ? formatDate(to) : "…"}` },
  ].filter(Boolean) as { key: string; label: string; value: string }[];

  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" description="Every important change: who did it, when, and what changed." />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <FilterToolbar
          activeCount={active.length}
          end={
            <>
              {active.length > 0 && (
                <Link href="/audit" className="font-medium text-muted hover:text-text">
                  Reset
                </Link>
              )}
              <span>{data.total} entries</span>
            </>
          }
        >
          <FilterSelect name="type" label="Record" value={type} options={ENTITY_TYPES.map((t) => ({ value: t, label: label(t) }))} allLabel="All" />
          <FilterSelect name="who" label="Person" value={who} options={people.map((p) => ({ value: p.id, label: p.name }))} allLabel="Anyone" />
          <FilterDates label="When" from={from} to={to} />
        </FilterToolbar>
        <ActiveFilters clearHref="/audit" items={active.map((a) => ({ ...a, removeHref: a.key === "dates" ? hrefFor({ from: undefined, to: undefined }) : hrefFor({ [a.key]: undefined }) }))} />
        {data.rows.length === 0 ? (
          <EmptyState icon={active.length ? SearchX : ScrollText} title={active.length ? "Nothing matches these filters" : "No activity yet"} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th className="w-44">When</Th>
                    <Th className="w-44">Who</Th>
                    <Th className="w-28">Record</Th>
                    <Th>What happened</Th>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((r) => (
                    <Tr key={r.id}>
                      <Td className="py-2.5 align-top whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</Td>
                      <Td className="py-2.5 align-top">
                        <span className="flex items-center gap-2">
                          <Avatar name={r.userName ?? "System"} size={22} />
                          <span className="truncate">{r.userName ?? "System"}</span>
                        </span>
                      </Td>
                      <Td className="py-2.5 align-top">
                        <Badge tone="outline">{label(r.entityType)}</Badge>
                      </Td>
                      <Td className="py-2.5 align-top">
                        {r.summary ?? r.action}
                        <Changes oldValues={r.oldValues} newValues={r.newValues} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {data.rows.map((r) => (
                <li key={r.id} className="flex gap-3 px-4 py-3">
                  <Avatar name={r.userName ?? "System"} size={28} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-text">
                      <span className="font-medium">{r.userName ?? "System"}</span> <span className="text-text-2">{r.summary ?? r.action}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <Badge tone="outline">{label(r.entityType)}</Badge>
                      {formatDateTime(r.createdAt)}
                    </p>
                    <Changes oldValues={r.oldValues} newValues={r.newValues} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination base="/audit" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
