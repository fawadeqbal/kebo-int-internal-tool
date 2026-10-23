import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listQueries } from "@/modules/queries/repository";
import { parseQueryFilters } from "@/modules/queries/filters";
import { OPEN_STATUSES } from "@/modules/queries/workflow";
import { listActiveUsers } from "@/modules/users/repository";
import { Button, ButtonLink, buttonClass, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { PriorityBadge, QueryStatusBadge } from "@/components/ui/badge";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { PRIORITY_LABEL, QUERY_STATUS_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Queries" };

const VIEWS = [
  { key: "open", label: "Open", params: { status: "open" } },
  { key: "mine", label: "Assigned to me", params: { status: "open", assignee: "me" } },
  { key: "unassigned", label: "Unassigned", params: { status: "open", assignee: "unassigned" } },
  { key: "overdue", label: "Overdue", params: { status: "overdue" } },
  { key: "completed", label: "Completed", params: { status: "completed" } },
  { key: "all", label: "All", params: {} },
] as const;

export default async function QueriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseQueryFilters(sp);
  const [data, people] = await Promise.all([listQueries(user, { ...filters, page: toPage(sp.page) }), listActiveUsers()]);
  const today = todayISO();
  const activeView = VIEWS.find((v) => {
    const p = v.params as Record<string, string>;
    return (p.status ?? undefined) === filters.raw.status && (p.assignee ?? undefined) === filters.raw.assignee;
  })?.key;
  const hasExtraFilters = !!(filters.q || filters.priority || filters.from || filters.to || filters.customerId || (filters.assignee && !activeView));
  const exportHref = buildHref("/api/queries/export", filters.raw, {});

  return (
    <>
      <PageHeader
        title="Queries"
        description="Customer queries and orders, from first contact to completion."
        actions={
          <>
            <a href={exportHref} className={buttonClass("secondary")}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
            {can(user.role, "queries.create") && <ButtonLink href="/queries/new">New query</ButtonLink>}
          </>
        }
      />

      <nav aria-label="Quick views" className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={buildHref("/queries", {}, v.params)}
            aria-current={activeView === v.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              activeView === v.key ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <Card>
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Search
            <Input id="search" name="q" defaultValue={filters.q} placeholder="Ref no., title, company or contact" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Status
            <Select name="status" defaultValue={filters.raw.status ?? ""}>
              <option value="">Any status</option>
              <option value="open">Open (not closed)</option>
              <option value="overdue">Overdue</option>
              {Object.entries(QUERY_STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Assigned to
            <Select name="assignee" defaultValue={filters.raw.assignee ?? ""}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Priority
            <Select name="priority" defaultValue={filters.raw.priority ?? ""}>
              <option value="">Any priority</option>
              {Object.entries(PRIORITY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <details className="group sm:col-span-2 lg:col-span-1 lg:row-start-2 lg:col-start-1 lg:col-end-6" open={!!(filters.from || filters.to || filters.sort)}>
            <summary className="cursor-pointer text-sm text-muted hover:text-ink">More filters</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Created from
                <Input type="date" name="from" defaultValue={filters.from} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Created to
                <Input type="date" name="to" defaultValue={filters.to} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Sort by
                <Select name="sort" defaultValue={filters.sort ?? "newest"}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="required">Required-by date</option>
                  <option value="priority">Priority</option>
                  <option value="updated">Recently updated</option>
                </Select>
              </label>
            </div>
          </details>
          {filters.customerId && <input type="hidden" name="customer" value={filters.customerId} />}
          <div className="flex items-end gap-2 lg:row-start-1 lg:col-start-5">
            <Button variant="secondary">Apply</Button>
            {(hasExtraFilters || filters.raw.status) && (
              <Link href="/queries" className="pb-2.5 text-sm text-muted hover:text-ink">
                Reset
              </Link>
            )}
          </div>
        </form>

        {data.rows.length === 0 ? (
          <EmptyState
            title="No queries found"
            description={hasExtraFilters || filters.status ? "Try changing the filters." : "When a customer contacts you, record it here."}
            action={can(user.role, "queries.create") && <ButtonLink href="/queries/new">New query</ButtonLink>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Query</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Priority</Th>
                <Th>Assigned to</Th>
                <Th>Required by</Th>
                <Th>Received</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const overdue = !!r.requiredBy && r.requiredBy < today && OPEN_STATUSES.includes(r.status);
                return (
                  <tr key={r.id} className="group hover:bg-canvas/60">
                    <Td className="whitespace-nowrap font-mono text-xs">
                      <Link href={`/queries/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                        {r.refNo}
                      </Link>
                    </Td>
                    <Td className="max-w-72">
                      <Link href={`/queries/${r.id}`} className="font-medium text-ink hover:underline">
                        {r.title}
                      </Link>
                      {r.category && <p className="truncate text-xs text-muted">{r.category}</p>}
                    </Td>
                    <Td>
                      <span className="block font-medium">{r.companyName}</span>
                      <span className="text-xs text-muted">{r.contactPerson}</span>
                    </Td>
                    <Td>
                      <QueryStatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <PriorityBadge priority={r.priority} />
                    </Td>
                    <Td className={r.assigneeName ? "" : "text-muted italic"}>{r.assigneeName ?? "Unassigned"}</Td>
                    <Td className={cn("whitespace-nowrap", overdue && "font-semibold text-red-700")}>
                      {formatDate(r.requiredBy)}
                      {overdue && <span className="block text-xs font-medium">Overdue</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(r.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base="/queries" params={filters.raw} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
