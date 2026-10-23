import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { listInvoices, type InvoiceFilters } from "@/modules/invoices/repository";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { Button, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { Pagination, toPage } from "@/components/ui/pagination";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";

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
    <>
      <PageHeader title="Invoices" description="Made from quotations the customer accepted." />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4" role="search">
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
            Search
            <Input id="search" name="q" defaultValue={q} placeholder="Invoice no., customer, RFQ no. or product" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Status
            <Select name="status" defaultValue={status ?? ""} className="w-60">
              <option value="">Any status</option>
              {Object.entries(STATUSES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="secondary">Apply</Button>
          {(q || status) && (
            <Link href="/invoices" className="pb-2.5 text-sm text-muted hover:text-ink">
              Reset
            </Link>
          )}
        </form>
        {data.rows.length === 0 ? (
          <EmptyState title="No invoices found" description="Open an accepted quotation and choose “Generate invoice”." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance due</Th>
                <Th>Issued</Th>
                <Th>Payment due</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const display = invoiceDisplayStatus(r, today);
                const balance = r.status === "cancelled" ? 0 : toCents(r.total) - toCents(r.amountPaid);
                return (
                  <tr key={r.id} className="hover:bg-canvas/60">
                    <Td>
                      <Link href={`/invoices/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.invoiceNo}
                      </Link>
                      <Link href={`/queries/${r.queryId}`} className="block font-mono text-xs text-muted hover:underline">
                        {r.queryRef}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/customers/${r.customerId}`} className="hover:underline">
                        {r.companyName}
                      </Link>
                    </Td>
                    <Td>
                      <InvoiceStatusBadge status={display} />
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.total, settings.currency)}</Td>
                    <Td className="text-right tabular-nums font-medium">{balance > 0 ? formatCents(balance, settings.currency) : "—"}</Td>
                    <Td className="text-muted">{formatDate(r.issueDate)}</Td>
                    <Td className={display === "overdue" ? "font-semibold text-red-700" : ""}>{formatDate(r.dueDate)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base="/invoices" params={{ q, status }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
