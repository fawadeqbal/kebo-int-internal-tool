import Link from "next/link";
import { ClipboardList, Download, Plus, Search, SearchX, X } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listQueries } from "@/modules/queries/repository";
import { parseQueryFilters } from "@/modules/queries/filters";
import { statusCounts } from "@/modules/reports/repository";
import { InboxList, InboxTable } from "@/modules/queries/components/inbox";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { buttonClass, controlClass, EmptyState, FilterBar, FilterChip, LinkTabs, PageHeader } from "@/components/ui";
import { todayISO } from "@/lib/utils/dates";
import { QUERY_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Inquiries" };

type Tab = { key: string; label: string; status: string; count: number; alert?: boolean };

export default async function QueriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mine = sp.assignee === "me";
  // The default view is the work still open: what people come here to act on.
  const filters = parseQueryFilters({ ...sp, status: sp.status ?? "open" });
  const status = sp.status === "all" ? "all" : filters.raw.status;
  const [data, counts] = await Promise.all([listQueries(user, { ...filters, page: toPage(sp.page) }), statusCounts(user, mine ? user.id : undefined)]);

  const tabs: Tab[] = [
    { key: "open", label: "Open", status: "open", count: counts.pending + counts.processing },
    { key: "overdue", label: "Overdue", status: "overdue", count: counts.overdue, alert: counts.overdue > 0 },
    { key: "completed", label: "Completed", status: "completed", count: counts.completed },
    { key: "not_completed", label: "Not completed", status: "not_completed", count: counts.not_completed },
    { key: "all", label: "All", status: "all", count: counts.pending + counts.processing + counts.completed + counts.not_completed },
  ];
  const keep = { q: filters.q, assignee: mine ? "me" : undefined };
  const statusParam = status === "open" ? undefined : status;
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/queries", { ...keep, status: statusParam }, patch);
  const today = todayISO();
  const now = new Date();
  const canCreate = can(user.role, "queries.create");
  const extraStatus = status && !tabs.some((t) => t.status === status) ? (QUERY_STATUS_LABEL[status as keyof typeof QUERY_STATUS_LABEL] ?? status) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inquiries"
        description={
          counts.pending > 0 ? (
            <>
              <span className="font-medium text-warn">{counts.pending} waiting to be started</span>
              {counts.unassigned > 0 && `, ${counts.unassigned} not assigned`}
            </>
          ) : (
            "Nothing waiting to be started"
          )
        }
        actions={
          <>
            <a href={buildHref("/api/queries/export", filters.raw, {})} className={buttonClass("secondary", "sm")} title="Download this list as a spreadsheet (CSV)">
              <Download aria-hidden /> Export
            </a>
            {canCreate && (
              <Link href="/queries/new" className={cn(buttonClass("primary", "sm"), "hidden sm:inline-flex")}>
                <Plus aria-hidden /> New inquiry
              </Link>
            )}
          </>
        }
      />

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <LinkTabs
          label="Filter by status"
          className="px-2"
          tabs={[
            ...tabs.map((t) => ({ href: hrefFor({ status: t.status === "open" ? undefined : t.status, page: undefined }), label: t.label, count: t.count, alert: t.alert, active: status === t.status })),
            ...(extraStatus ? [{ href: hrefFor({ status: undefined, page: undefined }), label: <span className="inline-flex items-center gap-1">{extraStatus} <X className="size-3.5" aria-label="Remove filter" /></span>, active: true }] : []),
          ]}
        />

        <FilterBar end={<span className="hidden text-xs text-muted tabular sm:inline">{data.total} {data.total === 1 ? "inquiry" : "inquiries"}</span>}>
          <form role="search" className="relative w-full sm:w-72">
            <label htmlFor="search" className="sr-only">
              Search inquiries
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input id="search" name="q" type="search" defaultValue={filters.q} placeholder="Customer, product or RFQ no." className={cn(controlClass, "h-8 pr-8 pl-9")} />
            {statusParam && <input type="hidden" name="status" value={statusParam} />}
            {mine && <input type="hidden" name="assignee" value="me" />}
            {filters.q && (
              <Link href={hrefFor({ q: undefined })} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-text" aria-label="Clear search">
                <X className="size-3.5" />
              </Link>
            )}
          </form>
          <FilterChip href={hrefFor({ assignee: mine ? undefined : "me", page: undefined })} active={mine}>
            Handled by me
          </FilterChip>
        </FilterBar>

        {data.rows.length === 0 ? (
          <EmptyState
            icon={filters.q ? SearchX : ClipboardList}
            title={filters.q ? `Nothing matches “${filters.q}”` : status === "overdue" ? "Nothing is overdue" : status === "open" ? "No open inquiries" : "No inquiries here yet"}
            description={
              filters.q
                ? "Try the customer's name, company or part of the product name."
                : status === "open"
                  ? "Website RFQs appear here by themselves. Add WhatsApp, WeChat or phone inquiries with New inquiry."
                  : "Try another tab."
            }
            action={
              canCreate && !filters.q && status === "open" ? (
                <Link href="/queries/new" className={buttonClass("primary", "sm")}>
                  <Plus aria-hidden /> New inquiry
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <InboxTable items={data.rows} today={today} now={now} />
            <InboxList items={data.rows} today={today} now={now} />
          </>
        )}
        {data.total > data.pageSize && <Pagination base="/queries" params={{ ...keep, status: statusParam }} page={data.page} pageSize={data.pageSize} total={data.total} />}
      </div>
    </div>
  );
}
