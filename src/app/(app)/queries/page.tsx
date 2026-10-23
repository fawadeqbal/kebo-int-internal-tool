import Link from "next/link";
import { Download, Plus, Search, X } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listQueries } from "@/modules/queries/repository";
import { parseQueryFilters } from "@/modules/queries/filters";
import { statusCounts } from "@/modules/reports/repository";
import { InboxRow } from "@/modules/queries/components/inbox";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { buttonClass } from "@/components/ui";
import { todayISO } from "@/lib/utils/dates";
import { QUERY_STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Inquiries" };

type Tab = { key: string; label: string; status?: string; count: number; alert?: boolean };

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
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/queries", { ...keep, status: status === "open" ? undefined : status }, patch);
  const today = todayISO();
  const now = new Date();
  const needAction = counts.pending;
  const canCreate = can(user.role, "queries.create");

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:mx-auto lg:mt-0 lg:max-w-4xl">
      {/* Title and the one filter that is about "me" */}
      <div className="px-4 pt-5 sm:px-6 lg:px-0 lg:pt-0">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Inquiries</h1>
            <p className="mt-0.5 text-sm text-muted">
              {needAction > 0 ? (
                <>
                  <span className="font-medium text-amber-700">{needAction} waiting to be started</span>
                  {counts.unassigned > 0 && `, ${counts.unassigned} not assigned`}
                </>
              ) : (
                "Nothing waiting to be started"
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={buildHref("/api/queries/export", filters.raw, {})}
              className="hidden h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-black/5 hover:text-ink sm:inline-flex"
              title="Download this list as a spreadsheet (CSV)"
            >
              <Download className="h-4 w-4" aria-hidden /> Export
            </a>
            <Link
              href={hrefFor({ assignee: mine ? undefined : "me", status: status === "open" ? undefined : status, page: undefined })}
              aria-pressed={mine}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm ring-1 ring-inset transition-colors",
                mine ? "bg-brand-600 text-white ring-brand-600" : "bg-surface text-ink ring-line hover:bg-black/[0.03]",
              )}
            >
              <span className={cn("grid h-4 w-4 place-items-center rounded-full border text-[10px]", mine ? "border-white bg-white text-brand-700" : "border-muted/60")} aria-hidden>
                {mine ? "✓" : ""}
              </span>
              Mine
            </Link>
          </div>
        </div>

      </div>

      {/* Search and status tabs stay pinned while scrolling on phones */}
      <div className="sticky top-0 z-10 bg-canvas/95 px-4 pb-3 pt-4 backdrop-blur sm:px-6 lg:static lg:px-0 lg:backdrop-blur-none">
        <form role="search" className="relative">
          <label htmlFor="search" className="sr-only">
            Search inquiries
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="search"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Search customer, company, product or RFQ no."
            className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-10 text-[15px] shadow-xs placeholder:text-muted/80 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100"
          />
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          {mine && <input type="hidden" name="assignee" value="me" />}
          {filters.q && (
            <Link
              href={hrefFor({ q: undefined })}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </Link>
          )}
        </form>

        <div className="mt-3">
          <nav aria-label="Filter by status" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => {
              const active = status === t.status;
              return (
                <Link
                  key={t.key}
                  href={hrefFor({ status: t.status === "open" ? undefined : t.status, page: undefined })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors",
                    active ? "bg-ink text-white" : "bg-surface text-ink ring-1 ring-line ring-inset hover:bg-black/[0.03]",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "tabular-nums text-xs",
                      active ? "text-white/70" : t.alert ? "font-semibold text-red-700" : "text-muted",
                    )}
                  >
                    {t.count}
                  </span>
                </Link>
              );
            })}
            {status && !tabs.some((t) => t.status === status) && (
              <Link
                href={hrefFor({ status: undefined, page: undefined })}
                aria-current="page"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 text-sm text-white"
                aria-label={`Showing ${QUERY_STATUS_LABEL[status as keyof typeof QUERY_STATUS_LABEL] ?? status}. Remove filter`}
              >
                {QUERY_STATUS_LABEL[status as keyof typeof QUERY_STATUS_LABEL] ?? status}
                <X className="h-3.5 w-3.5 text-white/70" aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      </div>

      {/* The list */}
      <section aria-label="Queries" className="border-y border-line bg-surface lg:mt-2 lg:rounded-2xl lg:border">
        {data.rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-base font-semibold">
              {filters.q ? `Nothing matches “${filters.q}”` : status === "overdue" ? "Nothing is overdue" : status === "open" ? "No open inquiries" : "No inquiries here yet"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
              {filters.q
                ? "Try the customer's name, company or part of the product name."
                : status === "open"
                  ? "Website RFQs appear here by themselves. Add WhatsApp, WeChat or phone inquiries with the + button."
                  : "Try another tab."}
            </p>
            {canCreate && !filters.q && status === "open" && (
              <Link href="/queries/new" className={buttonClass("primary", "md", "mt-5")}>
                <Plus className="h-4 w-4" aria-hidden /> New inquiry
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((r) => (
              <InboxRow key={r.id} item={r} today={today} now={now} />
            ))}
          </ul>
        )}
        {data.total > data.pageSize && (
          <div className="border-t border-line">
            <Pagination base="/queries" params={{ ...keep, status: status === "open" ? undefined : status }} page={data.page} pageSize={data.pageSize} total={data.total} />
          </div>
        )}
      </section>
    </div>
  );
}
