import Link from "next/link";
import { ScrollText } from "lucide-react";
import { can } from "@kebo/shared";
import { Badge, ButtonLink, Card, cn, EmptyState, FilterBar, PageHeader, Pagination, toPage } from "@kebo/ui";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { dateTime, timeAgo } from "@/lib/format";
import type { Paged, Person } from "@/lib/types";
import type { AuditRow } from "@/lib/types-people";

export const metadata = { title: "Audit log" };

const ENTITY_LABEL: Record<string, string> = {
  inquiry: "Deal",
  customer: "Customer",
  factory: "Factory",
  factory_quote: "Factory prices",
  quotation: "Quotation",
  order: "Order",
  payment: "Payment",
  // Entries written before orders were simplified (Oct 2026).
  factory_order: "Factory order (old)",
  invoice: "Invoice (old)",
  shipment: "Shipment (old)",
  attachment: "File",
  user: "Person",
  settings: "Settings",
};

const PAGE_SIZE = 50;

/** Where an entry's record lives, when it has a screen. */
function entityHref(r: AuditRow, canUsers: boolean): string | null {
  if (!r.entityId) return null;
  switch (r.entityType) {
    case "inquiry":
      return `/deals/${r.entityId}`;
    case "customer":
      return `/customers/${r.entityId}`;
    case "factory":
      return `/factories/${r.entityId}`;
    case "order":
      return `/orders/${r.entityId}`;
    case "user":
      return canUsers ? `/users/${r.entityId}` : null;
    default:
      return null;
  }
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Fields whose value changed. When the entry recorded values but none of them
 * differ (e.g. only a customer's contacts were edited), all recorded values.
 */
function changes(r: AuditRow): { rows: { key: string; from: unknown; to: unknown }[]; changed: boolean } {
  const before = r.oldValues ?? {};
  const after = r.newValues ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const all = keys.map((k) => ({ key: k, from: before[k], to: after[k] }));
  const diff = all.filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
  return diff.length ? { rows: diff, changed: true } : { rows: all, changed: false };
}

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();

/** Who changed what and when. Filter by kind of record and by person; open an entry to see old → new values. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("audit.view");
  const sp = await searchParams;
  const [data, people] = await Promise.all([
    api.get<Paged<AuditRow>>("/audit", { entityType: sp.type, userId: sp.person, page: toPage(sp.page), pageSize: PAGE_SIZE }),
    api.get<Person[]>("/users/people"),
  ]);
  const keep = { type: sp.type, person: sp.person };
  const canUsers = can(me, "users.manage");
  const filtered = !!(sp.type || sp.person);
  return (
    <div>
      <PageHeader title="Audit log" description="Every change anyone made, newest first. Entries cannot be edited or removed." />
      <Card className="overflow-hidden p-0">
        <FilterBar end={<span className="text-xs text-muted tabular">{data.total.toLocaleString("en-US")} entries</span>}>
          <form className="flex flex-1 flex-wrap items-center gap-2">
            <AutoSelect name="type" defaultValue={sp.type ?? ""} aria-label="Kind of record" className="w-full sm:w-48">
              <option value="">Every kind of record</option>
              {Object.entries(ENTITY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </AutoSelect>
            <AutoSelect name="person" defaultValue={sp.person ?? ""} aria-label="Person" className="w-full sm:w-48">
              <option value="">Anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </AutoSelect>
            {filtered && (
              <Link href="/audit" className="text-xs font-medium text-muted hover:text-text">
                Clear filters
              </Link>
            )}
          </form>
        </FilterBar>
        {data.rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No entries" description={filtered ? "Nothing matches these filters." : "Changes will be recorded here."} action={filtered ? <ButtonLink href="/audit">Clear filters</ButtonLink> : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((r) => {
              const href = entityHref(r, canUsers);
              const diff = changes(r);
              return (
                <li key={r.id} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[150px_140px_minmax(0,1fr)]">
                  <time dateTime={r.createdAt} title={dateTime(r.createdAt)} className="text-xs text-muted tabular sm:pt-0.5">
                    {dateTime(r.createdAt)}
                    <span className="block text-[11px] sm:hidden">{timeAgo(r.createdAt)}</span>
                  </time>
                  <span className="truncate text-sm font-medium">{r.userName}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <Badge tone="outline">{ENTITY_LABEL[r.entityType] ?? r.entityType}</Badge>
                      {href ? (
                        <Link href={href} className="hover:text-primary hover:underline">
                          {r.summary ?? words(r.action)}
                        </Link>
                      ) : (
                        <span>{r.summary ?? words(r.action)}</span>
                      )}
                    </p>
                    {diff.rows.length > 0 && (
                      <details className="group mt-1.5">
                        <summary className="cursor-pointer text-xs font-medium text-primary select-none hover:underline">
                          <span className="group-open:hidden">{diff.changed ? `Show ${diff.rows.length} change${diff.rows.length === 1 ? "" : "s"}` : "Show recorded values"}</span>
                          <span className="hidden group-open:inline">{diff.changed ? "Hide changes" : "Hide values"}</span>
                        </summary>
                        {!diff.changed && <p className="mt-1.5 text-xs text-muted">None of these fields changed{r.entityType === "customer" ? " (only contacts were edited)" : ""}.</p>}
                        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                          <table className="w-full text-xs">
                            <thead className="bg-surface-2/60 text-muted">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-medium">Field</th>
                                <th className="px-3 py-1.5 text-left font-medium">Before</th>
                                <th className="px-3 py-1.5 text-left font-medium">After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diff.rows.map((c) => (
                                <tr key={c.key} className="border-t border-line align-top">
                                  <td className="px-3 py-1.5 whitespace-nowrap text-text-2">{words(c.key)}</td>
                                  <td className={cn("max-w-72 px-3 py-1.5 break-words", diff.changed ? "text-bad line-through decoration-bad/40" : "text-text-2")}>{show(c.from)}</td>
                                  <td className={cn("max-w-72 px-3 py-1.5 break-words", diff.changed ? "text-ok" : "text-text-2")}>{show(c.to)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data.total > data.pageSize && <Pagination base="/audit" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />}
      </Card>
    </div>
  );
}
