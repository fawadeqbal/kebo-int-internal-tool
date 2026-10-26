import Link from "next/link";
import { Receipt, SearchX } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listInvoices } from "@/modules/invoices/repository";
import { INVOICE_SORTS, INVOICE_STATUSES, parseInvoiceParams } from "@/lib/list-filters";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { ActiveFilters, EmptyState, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { FilterDates, FilterSelect, FilterToolbar } from "@/components/ui/filters";
import { ExportMenu } from "@/components/ui/export-menu";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Invoices" };

const STATUSES = INVOICE_STATUSES;
const SORTS = INVOICE_SORTS;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePagePermission("invoices.manage");
  const sp = await searchParams;
  const { filters, params, active } = parseInvoiceParams(sp);
  const { q, status, from, to, sort } = filters;
  const data = await listInvoices(user, { ...filters, page: toPage(sp.page) });
  const today = todayISO();
  const hrefFor = (patch: Record<string, string | undefined>) => buildHref("/invoices", params, { page: undefined, ...patch });
  const clearHref = buildHref("/invoices", { q }, {});

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" description="Made from quotations the customer accepted." actions={<ExportMenu pdfHref={buildHref("/api/export/invoices/pdf", params, {})} />} />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <FilterToolbar
          activeCount={active.length}
          search={<SearchField defaultValue={q} placeholder="Invoice no., customer, RFQ no. or product" clearHref={hrefFor({ q: undefined })} label="Search invoices" />}
          end={
            <>
              {active.length > 0 && (
                <Link href={clearHref} className="font-medium text-muted hover:text-text">
                  Reset
                </Link>
              )}
              <span>{data.total} invoices</span>
            </>
          }
        >
          <FilterSelect name="status" label="Status" value={status} options={Object.entries(STATUSES).map(([value, label]) => ({ value, label }))} />
          <FilterDates label="Issued" from={from} to={to} />
          <FilterSelect name="sort" label="Sort" value={sort ?? "newest"} options={SORTS} keepDefault="newest" />
        </FilterToolbar>
        <ActiveFilters clearHref={clearHref} items={active.map((a) => ({ ...a, removeHref: hrefFor(Object.fromEntries(a.clear.map((k) => [k, undefined]))) }))} />

        {data.rows.length === 0 ? (
          <EmptyState
            icon={q || active.length ? SearchX : Receipt}
            title={q || active.length ? "No invoices match" : "No invoices yet"}
            description={q || active.length ? "Try another word, or remove a filter." : "Open an accepted quotation and choose “Generate invoice”."}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Customer</Th>
                    <Th>Status</Th>
                    <Th className="hidden text-right lg:table-cell">Total</Th>
                    <Th className="text-right">Balance due</Th>
                    <Th className="hidden lg:table-cell">Issued</Th>
                    <Th>Payment due</Th>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((r) => {
                    const display = invoiceDisplayStatus(r, today);
                    const balance = r.status === "cancelled" ? 0 : toCents(r.total) - toCents(r.amountPaid);
                    return (
                      <Tr key={r.id} className="group relative hover:bg-surface-2/70">
                        <Td className="py-2 whitespace-nowrap">
                          <Link href={`/invoices/${r.id}`} className="font-mono text-[13px] font-medium text-text group-hover:text-primary after:absolute after:inset-0 after:content-['']">
                            {r.invoiceNo}
                          </Link>
                          <p className="font-mono text-[11px] text-muted">{r.queryRef}</p>
                        </Td>
                        <Td className="max-w-56 truncate text-text-2">{r.companyName}</Td>
                        <Td>
                          <InvoiceStatusBadge status={display} />
                        </Td>
                        <Td className="hidden text-right whitespace-nowrap text-text-2 tabular lg:table-cell">{formatMoney(r.total, r.currency)}</Td>
                        <Td className="text-right font-medium whitespace-nowrap tabular">{balance > 0 ? formatCents(balance, r.currency) : <span className="text-muted">—</span>}</Td>
                        <Td className="hidden whitespace-nowrap text-muted lg:table-cell">{formatDate(r.issueDate)}</Td>
                        <Td className={cn("whitespace-nowrap", display === "overdue" ? "font-medium text-bad" : "text-text-2")}>{formatDate(r.dueDate)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {data.rows.map((r) => {
                const display = invoiceDisplayStatus(r, today);
                const balance = r.status === "cancelled" ? 0 : toCents(r.total) - toCents(r.amountPaid);
                return (
                  <li key={r.id}>
                    <Link href={`/invoices/${r.id}`} className="block px-4 py-3 active:bg-surface-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[13px] font-medium text-text">{r.invoiceNo}</span>
                        <span className="text-sm font-semibold text-text tabular">{formatMoney(r.total, r.currency)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-text-2">{r.companyName}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <InvoiceStatusBadge status={display} />
                        <span className={cn("text-xs", display === "overdue" ? "font-medium text-bad" : "text-muted")}>
                          {balance > 0 ? `${formatCents(balance, r.currency)} due ${formatDate(r.dueDate)}` : `Due ${formatDate(r.dueDate)}`}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Pagination base="/invoices" params={params} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
