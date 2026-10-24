import Link from "next/link";
import { ClipboardList, Plus, SearchX, X } from "lucide-react";
import { ExportMenu } from "@/components/ui/export-menu";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { countByStatus, listCategoriesInUse, listQueries, mergeCategories } from "@/modules/queries/repository";
import { parseQueryFilters } from "@/modules/queries/filters";
import { INQUIRY_SORTS, inquiryActiveFilters } from "@/lib/list-filters";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { InboxList, InboxTable } from "@/modules/queries/components/inbox";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { ActiveFilters, buttonClass, EmptyState, LinkTabs, PageHeader, SearchField } from "@/components/ui";
import { FilterDates, FilterSelect, FilterToolbar } from "@/components/ui/filters";
import { todayISO } from "@/lib/utils/dates";
import { PRIORITY_LABEL, QUERY_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Inquiries" };

const SORTS = INQUIRY_SORTS;

export default async function QueriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // The default view is the work still open: what people come here to act on.
  const filters = parseQueryFilters({ ...sp, status: sp.status ?? "open" });
  const status = sp.status === "all" ? "all" : filters.raw.status;
  const [data, counts, people, settings, usedCategories] = await Promise.all([listQueries(user, { ...filters, page: toPage(sp.page) }), countByStatus(user, filters), listActiveUsers(), getSettings(), listCategoriesInUse()]);

  const raw = filters.raw;
  const statusParam = status === "open" ? undefined : status;
  /** Every current filter, with `patch` applied (page always resets). */
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/queries", { ...raw, status: statusParam }, { page: undefined, ...patch });
  const today = todayISO();
  const now = new Date();
  const canCreate = can(user.role, "queries.create");

  const tabs = [
    { label: "Open", status: "open", count: counts.pending + counts.processing },
    { label: "Overdue", status: "overdue", count: counts.overdue, alert: counts.overdue > 0 },
    { label: "Completed", status: "completed", count: counts.completed },
    { label: "Not completed", status: "not_completed", count: counts.not_completed },
    { label: "All", status: "all", count: counts.pending + counts.processing + counts.completed + counts.not_completed },
  ];
  const extraStatus = status && !tabs.some((t) => t.status === status) ? (QUERY_STATUS_LABEL[status as keyof typeof QUERY_STATUS_LABEL] ?? status) : null;

  const personOptions = [
    { value: "me", label: "Me" },
    { value: "unassigned", label: "Not assigned" },
    ...people.filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.name })),
  ];
  const merged = mergeCategories(settings.categories, usedCategories);
  const categories = [...merged, ...(raw.category && !merged.includes(raw.category) ? [raw.category] : [])];
  const sourceOptions = Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }));
  const priorityOptions = Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));

  const active = inquiryActiveFilters(raw, people, user.id);

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
            <ExportMenu pdfHref={buildHref("/api/export/inquiries/pdf", { ...raw, status: statusParam }, {})} csvHref={buildHref("/api/queries/export", raw, {})} />
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
            ...tabs.map((t) => ({ href: hrefFor({ status: t.status === "open" ? undefined : t.status }), label: t.label, count: t.count, alert: t.alert, active: status === t.status })),
            ...(extraStatus ? [{ href: hrefFor({ status: undefined }), label: <span className="inline-flex items-center gap-1">{extraStatus} <X className="size-3.5" aria-label="Remove filter" /></span>, active: true }] : []),
          ]}
        />

        <FilterToolbar
          hidden={{ status: statusParam }}
          activeCount={active.length}
          search={<SearchField defaultValue={raw.q} placeholder="Customer, product or RFQ no." clearHref={hrefFor({ q: undefined })} label="Search inquiries" />}
          end={
            <>
              {active.length > 0 && (
                <Link href={buildHref("/queries", { q: raw.q, status: statusParam }, {})} className="font-medium text-muted hover:text-text">
                  Reset
                </Link>
              )}
              <span>
                {data.total} {data.total === 1 ? "inquiry" : "inquiries"}
              </span>
            </>
          }
        >
          <FilterSelect name="assignee" label="Handled by" value={raw.assignee} options={personOptions} allLabel="Anyone" />
          <FilterSelect name="category" label="Category" value={raw.category} options={categories.map((c) => ({ value: c, label: c }))} allLabel="All" />
          <FilterSelect name="source" label="Via" value={raw.source} options={sourceOptions} allLabel="Any channel" />
          <FilterSelect name="priority" label="Priority" value={raw.priority} options={priorityOptions} allLabel="Any" />
          <FilterDates label="Received" from={raw.from} to={raw.to} />
          <FilterSelect name="sort" label="Sort" value={raw.sort ?? "newest"} options={SORTS} keepDefault="newest" />
        </FilterToolbar>
        <ActiveFilters
          clearHref={buildHref("/queries", { q: raw.q, status: statusParam }, {})}
          items={active.map((a) => ({ label: a.label, value: a.value, removeHref: hrefFor(Object.fromEntries(a.clear.map((k) => [k, undefined]))) }))}
        />

        {data.rows.length === 0 ? (
          <EmptyState
            icon={raw.q || active.length ? SearchX : ClipboardList}
            title={raw.q ? `Nothing matches “${raw.q}”` : active.length ? "No inquiries match these filters" : status === "overdue" ? "Nothing is overdue" : status === "open" ? "No open inquiries" : "No inquiries here yet"}
            description={
              raw.q || active.length
                ? "Try another word, or remove a filter."
                : status === "open"
                  ? "Website RFQs appear here by themselves. Add WhatsApp, WeChat or phone inquiries with New inquiry."
                  : "Try another tab."
            }
            action={
              raw.q || active.length ? (
                <Link href="/queries" className={buttonClass("secondary", "sm")}>
                  Clear search and filters
                </Link>
              ) : canCreate && status === "open" ? (
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
        {data.total > data.pageSize && <Pagination base="/queries" params={{ ...raw, status: statusParam }} page={data.page} pageSize={data.pageSize} total={data.total} />}
      </div>
    </div>
  );
}
