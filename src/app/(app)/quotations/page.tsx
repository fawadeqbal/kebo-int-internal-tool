import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listQuotations } from "@/modules/quotations/repository";
import { getSettings } from "@/modules/settings/service";
import { Button, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { QuotationStatusBadge } from "@/components/ui/badge";
import { Pagination, toPage } from "@/components/ui/pagination";
import { QUOTATION_STATUS_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";
import type { QuotationStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const status = sp.status && (sp.status === "expiring" || sp.status in QUOTATION_STATUS_LABEL) ? (sp.status as QuotationStatus | "expiring") : undefined;
  const [data, settings] = await Promise.all([listQuotations(user, { q, status, page: toPage(sp.page) }), getSettings()]);
  const today = todayISO();
  return (
    <>
      <PageHeader title="Quotations" description="Offers sent to buyers. Start a quotation from an inquiry." />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4" role="search">
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium">
            Search
            <Input id="search" name="q" defaultValue={q} placeholder="Quotation no., RFQ no., product or buyer" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Status
            <Select name="status" defaultValue={status ?? ""} className="w-52">
              <option value="">Any status</option>
              <option value="expiring">Waiting for the buyer (soonest expiry first)</option>
              {Object.entries(QUOTATION_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="secondary">Apply</Button>
          {(q || status) && (
            <Link href="/quotations" className="pb-2.5 text-sm text-muted hover:text-ink">
              Reset
            </Link>
          )}
        </form>
        {data.rows.length === 0 ? (
          <EmptyState title="No quotations found" description="Open an inquiry and choose “Create quotation”." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quotation</Th>
                <Th>Inquiry</Th>
                <Th>Buyer</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th>Sent</Th>
                <Th>Valid until</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const late = r.status === "sent" && r.dueDate < today;
                return (
                  <tr key={r.id} className="hover:bg-canvas/60">
                    <Td className="whitespace-nowrap">
                      <Link href={`/quotations/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.refNo}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted">v{r.version}</span>
                    </Td>
                    <Td className="max-w-64">
                      <Link href={`/queries/${r.queryId}`} className="font-mono text-xs text-muted hover:underline">
                        {r.queryRef}
                      </Link>
                      <p className="truncate">{r.queryTitle}</p>
                    </Td>
                    <Td>{r.companyName}</Td>
                    <Td>
                      <QuotationStatusBadge status={r.status} />
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(r.total, settings.currency)}</Td>
                    <Td className="text-muted">{formatDate(r.submittedAt)}</Td>
                    <Td className={cn("whitespace-nowrap", late && "font-semibold text-red-700")}>{formatDate(r.dueDate)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base="/quotations" params={{ q, status }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
