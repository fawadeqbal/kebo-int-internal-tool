import Link from "next/link";
import { Receipt } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listInvoices, type InvoiceFilters } from "@/modules/invoices/repository";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { EmptyState, FilterBar, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { AutoSelect } from "@/components/ui/client";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Invoices" };

const STATUSES: Record<NonNullable<InvoiceFilters["status"]>, string> = {
  outstanding: "Outstanding (unpaid + partial)",
  overdue: "Overdue",
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const status = sp.status && sp.status in STATUSES ? (sp.status as InvoiceFilters["status"]) : undefined;
  const [data, settings] = await Promise.all([listInvoices(user, { q, status, page: toPage(sp.page) }), getSettings()]);
  const today = todayISO();
  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" description="Made from quotations the customer accepted." />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <form role="search">
          <FilterBar end={<span className="hidden text-xs text-muted tabular sm:inline">{data.total} invoices</span>}>
            <SearchField defaultValue={q} placeholder="Invoice no., customer, RFQ no. or product" clearHref={buildHref("/invoices", { status }, {})} label="Search invoices" />
            <AutoSelect name="status" defaultValue={status ?? ""} className="w-60" aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(STATUSES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </AutoSelect>
            {(q || status) && (
              <Link href="/invoices" className="text-xs font-medium text-muted hover:text-text">
                Reset
              </Link>
            )}
          </FilterBar>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices found" description="Open an accepted quotation and choose “Generate invoice”." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Invoice</Th>
                <Th className="hidden md:table-cell">Customer</Th>
                <Th>Status</Th>
                <Th className="hidden text-right lg:table-cell">Total</Th>
                <Th className="text-right">Balance due</Th>
                <Th className="hidden lg:table-cell">Issued</Th>
                <Th className="hidden sm:table-cell">Payment due</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((r) => {
                const display = invoiceDisplayStatus(r, today);
                const balance = r.status === "cancelled" ? 0 : toCents(r.total) - toCents(r.amountPaid);
                return (
                  <Tr key={r.id} className="group hover:bg-surface-2/70">
                    <Td className="py-2 whitespace-nowrap">
                      <Link href={`/invoices/${r.id}`} className="font-mono text-[13px] font-medium text-text group-hover:text-primary hover:underline">
                        {r.invoiceNo}
                      </Link>
                      <Link href={`/queries/${r.queryId}`} className="block font-mono text-[11px] text-muted hover:text-primary hover:underline">
                        {r.queryRef}
                      </Link>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <Link href={`/customers/${r.customerId}`} className="text-text-2 hover:text-primary hover:underline">
                        {r.companyName}
                      </Link>
                    </Td>
                    <Td>
                      <InvoiceStatusBadge status={display} />
                    </Td>
                    <Td className="hidden text-right whitespace-nowrap text-text-2 tabular lg:table-cell">{formatMoney(r.total, settings.currency)}</Td>
                    <Td className="text-right font-medium whitespace-nowrap tabular">{balance > 0 ? formatCents(balance, settings.currency) : <span className="text-muted">—</span>}</Td>
                    <Td className="hidden whitespace-nowrap text-muted lg:table-cell">{formatDate(r.issueDate)}</Td>
                    <Td className={cn("hidden whitespace-nowrap sm:table-cell", display === "overdue" ? "font-medium text-bad" : "text-text-2")}>{formatDate(r.dueDate)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base="/invoices" params={{ q, status }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
