import Link from "next/link";
import { can } from "@kebo/shared";
import { Badge, buildHref, ButtonLink, Card, cn, DataRow, Scroll, EmptyState, LinkTabs, PageHeader, Pager, PhoneList, PhoneRow, Td, Th, THead, toPage, toPageSize, Tr, linkClass, Stack } from "@kebo/ui";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { api } from "@/lib/api";
import { readableHistory } from "@/components/insights/readable-dates";
import { ExportCsv } from "@/components/sheets/export-link";
import { hasFeature, requirePermission } from "@/lib/session";
import { PlanOff } from "@/components/common/plan-off";
import { dateTime, timeAgo, countOf } from "@/lib/format";
import type { Paged } from "@/lib/types";
import type { AuditRow } from "@/lib/types-people";
import { crumbsFor } from "@/lib/nav";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Activity log" };

const ENTITY_LABEL: Record<string, string> = {
  inquiry: "Inquiry",
  customer: "Customer",
  factory: "Supplier",
  factory_quote: "Supplier prices",
  quotation: "Quotation",
  order: "Order",
  payment: "Payment",
  // Entries written before orders were simplified (Oct 2026).
  factory_order: "Purchase order (old)",
  invoice: "Invoice (old)",
  shipment: "Shipment (old)",
  attachment: "File",
  user: "Person",
  settings: "Settings",
};

const PAGE_SIZE = 25;

/** Where an entry's record lives, when it has a screen. */
function entityHref(r: AuditRow, canUsers: boolean): string | null {
  if (!r.entityId) return null;
  switch (r.entityType) {
    case "inquiry":
      return `/inquiries/${r.entityId}`;
    case "customer":
      return `/customers/${r.entityId}`;
    case "factory":
      return `/suppliers/${r.entityId}`;
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

/** "Show 3 changes": the fields, before → after (outside the row's link). */
function Changes({ r }: { r: AuditRow }) {
  const diff = changes(r);
  if (!diff.rows.length) return null;
  return (
    <details className="group mt-1.5" data-no-row>
      {/* A target a thumb can hit: 24px tall at least (WCAG 2.2), even under a phone row's link. */}
      <summary className={cn(linkClass, "inline-flex min-h-6 cursor-pointer items-center text-xs select-none")}>
        <span className="group-open:hidden">{diff.changed ? `Show ${diff.rows.length} change${diff.rows.length === 1 ? "" : "s"}` : "Show recorded values"}</span>
        <span className="hidden group-open:inline">{diff.changed ? "Hide changes" : "Hide values"}</span>
      </summary>
      {!diff.changed && <p className="mt-1.5 text-xs text-text-2">None of these fields changed{r.entityType === "customer" ? " (only contacts were edited)" : ""}.</p>}
      <Scroll axis="x" size="lg" fade label="What changed" className="mt-2 rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface-2/60 text-text-2">
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
      </Scroll>
    </details>
  );
}

/**
 * Who changed what and when (design system: List frame): a chip per kind of
 * record with its count (the most frequent; any other from "+ Kind"), a person
 * filter and Excel in one row; a row opens the record it is about (when it has
 * a page), its changes open under it; 25 a page, filters in the URL. Entries
 * cannot be edited or removed.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("audit.view");
  if (!(await hasFeature("audit_log"))) return <PlanOff title="Activity log" what="The activity log" crumbs={crumbsFor("/audit")} />;
  const sp = await searchParams;
  const [data, people] = await Promise.all([
    api.get<Paged<AuditRow> & { counts: Record<string, number> }>("/audit", { entityType: sp.type, userId: sp.person, q: sp.q?.trim() || undefined, page: toPage(sp.page), pageSize: toPageSize(sp.size, PAGE_SIZE) }),
    getPeople(),
  ]);
  const keep = { type: sp.type, person: sp.person, q: sp.q };
  const href = (patch: Record<string, string | undefined>) => buildHref("/audit", keep, { page: undefined, ...patch });
  const canUsers = can(me, "users.manage");
  const filtered = !!(sp.type || sp.person || sp.q);
  const label = (type: string) => ENTITY_LABEL[type] ?? type;
  const everything = Object.values(data.counts).reduce((a, b) => a + b, 0);
  // The four kinds with the most entries, and the one picked.
  const top = Object.entries(data.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);
  const kinds = sp.type && !top.includes(sp.type) ? [...top, sp.type] : top;
  const chips = [
    { key: "all", label: "All", count: everything, href: href({ type: undefined }), active: !sp.type },
    ...kinds.map((k) => ({ key: k, label: label(k), count: data.counts[k] ?? 0, href: href({ type: k }), active: sp.type === k })),
  ];
  const rowMenu = (r: AuditRow, to: string | null): MenuEntry[] => [
    ...(to ? [{ label: `Open the ${label(r.entityType).toLowerCase()}`, href: to }] : []),
    { label: `Only ${label(r.entityType).toLowerCase()} entries`, href: href({ type: r.entityType }) },
    ...(r.userId ? [{ label: `Only ${r.userName}'s changes`, href: href({ person: r.userId }) }] : []),
  ];

  return (
    <Stack>
      <PageHeader
        kind="list"
        crumbs={crumbsFor("/audit")}
        title="Activity log"
        more={<ExportCsv what="audit" query={{ type: sp.type, person: sp.person, q: sp.q }} />}
      />
      {/* How many entries is said once, beside the search (the filter's count), not again in a facts line. */}
      <LinkTabs label="Which records" tabs={chips.map((c) => ({ href: c.href, label: c.label, count: c.count, active: c.active }))} />
      <FilterCard
        count={countOf(data.total, "entry", "entries")}
        search="Search what, who or why…"
        value={sp.q}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "type", label: "Kind", value: sp.type, options: Object.entries(ENTITY_LABEL).map(([value, l]) => ({ value, label: l })) },
          { name: "person", label: "Person", all: "Anyone", value: sp.person, options: people.map((p) => ({ value: p.id, label: p.name })) },
        ]}
      />
      <Card className="overflow-clip">
        {data.rows.length === 0 ? (
          filtered ? (
            <EmptyState
              framed
              title="No entries match these filters"
              description="Try another kind of record or person, or clear the filters."
              action={
                <ButtonLink href="/audit" size="sm">
                  Clear filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState framed title="No entries yet" description="Every change anyone makes is recorded here, with who made it and when." />
          )
        ) : (
          <>
            <PhoneList label="Activity log">
              {data.rows.map((r) => (
                <PhoneRow
                  key={r.id}
                  href={entityHref(r, canUsers) ?? undefined}
                  title={r.summary ? readableHistory(r.summary) : words(r.action)}
                  line={`${r.userName} · ${label(r.entityType)}`}
                  figure={timeAgo(r.createdAt)}
                  extra={<Changes r={r} />}
                />
              ))}
            </PhoneList>
            <DataTable label="Activity log" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>What</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => {
                  const to = entityHref(r, canUsers);
                  const cells = (
                    <>
                      <Td className="w-40 py-2.5 align-top text-xs whitespace-nowrap text-text-2 tabular">
                        <time dateTime={r.createdAt} title={timeAgo(r.createdAt)}>
                          {dateTime(r.createdAt)}
                        </time>
                      </Td>
                      <Td className="w-40 py-2.5 align-top text-sm font-medium">{r.userName}</Td>
                      <Td className="py-2.5 align-top">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <Badge tone="outline">{label(r.entityType)}</Badge>
                          {to ? (
                            <Link href={to} className="hover:text-primary">
                              {r.summary ? readableHistory(r.summary) : words(r.action)}
                            </Link>
                          ) : (
                            <span>{r.summary ? readableHistory(r.summary) : words(r.action)}</span>
                          )}
                        </p>
                        <Changes r={r} />
                      </Td>
                      <Td className="py-2.5 text-right align-top">
                        <RowMenu items={rowMenu(r, to)} label={`Actions for the entry of ${dateTime(r.createdAt)}`} />
                      </Td>
                    </>
                  );
                  return to ? (
                    <DataRow key={r.id} href={to}>
                      {cells}
                    </DataRow>
                  ) : (
                    <Tr key={r.id} className="group">
                      {cells}
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
      </Card>
      <Pager base="/audit" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />
    </Stack>
  );
}
