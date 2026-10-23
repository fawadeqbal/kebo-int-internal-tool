import Link from "next/link";
import { FileText, SearchX } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listQuotations } from "@/modules/quotations/repository";
import { parseQuotationParams, QUOTATION_SORTS, QUOTATION_STATUS_OPTIONS } from "@/lib/list-filters";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { ActiveFilters, EmptyState, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { FilterDates, FilterSelect, FilterToolbar } from "@/components/ui/filters";
import { ExportMenu } from "@/components/ui/export-menu";
import { QuotationStatusBadge } from "@/components/ui/badge";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Quotations" };

const SORTS = QUOTATION_SORTS;

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const people = await listActiveUsers();
  const { filters, params, active } = parseQuotationParams(sp, people);
  const { q, status, preparedBy, from, to, sort } = filters;
  const [data, settings] = await Promise.all([listQuotations(user, { ...filters, page: toPage(sp.page) }), getSettings()]);
  const today = todayISO();
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/quotations", params, { page: undefined, ...patch });
  const statusOptions = QUOTATION_STATUS_OPTIONS;
  const clearHref = buildHref("/quotations", { q }, {});

  return (
    <div className="space-y-5">
      <PageHeader title="Quotations" description="Offers sent to customers. Start a quotation from an inquiry." actions={<ExportMenu pdfHref={buildHref("/api/export/quotations/pdf", params, {})} />} />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <FilterToolbar
          activeCount={active.length}
          search={<SearchField defaultValue={q} placeholder="Quotation no., RFQ no., product or customer" clearHref={hrefFor({ q: undefined })} label="Search quotations" />}
          end={
            <>
              {active.length > 0 && (
                <Link href={clearHref} className="font-medium text-muted hover:text-text">
                  Reset
                </Link>
              )}
              <span>{data.total} quotations</span>
            </>
          }
        >
          <FilterSelect name="status" label="Status" value={status} options={statusOptions} />
          <FilterSelect name="by" label="Prepared by" value={preparedBy} options={people.map((p) => ({ value: p.id, label: p.id === user.id ? `${p.name} (me)` : p.name }))} allLabel="Anyone" />
          <FilterDates label="Created" from={from} to={to} />
          <FilterSelect name="sort" label="Sort" value={sort ?? "newest"} options={SORTS} keepDefault="newest" />
        </FilterToolbar>
        <ActiveFilters clearHref={clearHref} items={active.map((a) => ({ ...a, removeHref: hrefFor(Object.fromEntries(a.clear.map((k) => [k, undefined]))) }))} />

        {data.rows.length === 0 ? (
          <EmptyState
            icon={q || active.length ? SearchX : FileText}
            title={q || active.length ? "No quotations match" : "No quotations yet"}
            description={q || active.length ? "Try another word, or remove a filter." : "Open an inquiry and choose “Create quotation”."}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Quotation</Th>
                    <Th>Inquiry</Th>
                    <Th className="hidden lg:table-cell">Customer</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="hidden xl:table-cell">Prepared by</Th>
                    <Th>Valid until</Th>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((r) => {
                    const late = r.status === "sent" && r.dueDate < today;
                    return (
                      <Tr key={r.id} className="group relative hover:bg-surface-2/70">
                        <Td className="whitespace-nowrap">
                          <Link href={`/quotations/${r.id}`} className="font-mono text-[13px] font-medium text-text group-hover:text-primary after:absolute after:inset-0 after:content-['']">
                            {r.refNo}
                          </Link>
                          <span className="ml-1.5 text-xs text-muted">v{r.version}</span>
                        </Td>
                        <Td className="max-w-72 py-2">
                          <p className="truncate text-text">{r.queryTitle}</p>
                          <p className="font-mono text-[11px] text-muted">{r.queryRef}</p>
                        </Td>
                        <Td className="hidden max-w-48 truncate text-text-2 lg:table-cell">{r.companyName}</Td>
                        <Td>
                          <QuotationStatusBadge status={r.status} />
                        </Td>
                        <Td className="text-right font-medium whitespace-nowrap tabular">{formatMoney(r.total, settings.currency)}</Td>
                        <Td className="hidden text-text-2 xl:table-cell">{r.preparedBy ?? "—"}</Td>
                        <Td className={cn("whitespace-nowrap", late ? "font-medium text-bad" : "text-text-2")}>{formatDate(r.dueDate)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {data.rows.map((r) => {
                const late = r.status === "sent" && r.dueDate < today;
                return (
                  <li key={r.id}>
                    <Link href={`/quotations/${r.id}`} className="block px-4 py-3 active:bg-surface-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[13px] font-medium text-text">
                          {r.refNo} <span className="font-sans text-xs font-normal text-muted">v{r.version}</span>
                        </span>
                        <span className="text-sm font-semibold text-text tabular">{formatMoney(r.total, settings.currency)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-text-2">{r.queryTitle}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <QuotationStatusBadge status={r.status} />
                          <span className="truncate text-xs text-muted">{r.companyName}</span>
                        </span>
                        <span className={cn("shrink-0 text-xs", late ? "font-medium text-bad" : "text-muted")}>until {formatDate(r.dueDate)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Pagination base="/quotations" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
