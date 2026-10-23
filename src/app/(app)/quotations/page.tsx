import Link from "next/link";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listQuotations } from "@/modules/quotations/repository";
import { getSettings } from "@/modules/settings/service";
import { EmptyState, FilterBar, PageHeader, SearchField, Table, THead, Td, Th, Tr } from "@/components/ui";
import { AutoSelect } from "@/components/ui/client";
import { QuotationStatusBadge } from "@/components/ui/badge";
import { buildHref, Pagination, toPage } from "@/components/ui/pagination";
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
    <div className="space-y-5">
      <PageHeader title="Quotations" description="Offers sent to customers. Start a quotation from an inquiry." />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <form role="search">
          <FilterBar end={<span className="hidden text-xs text-muted tabular sm:inline">{data.total} quotations</span>}>
            <SearchField defaultValue={q} placeholder="Quotation no., RFQ no., product or customer" clearHref={buildHref("/quotations", { status }, {})} label="Search quotations" />
            <AutoSelect name="status" defaultValue={status ?? ""} className="w-56" aria-label="Status">
              <option value="">Any status</option>
              <option value="expiring">Waiting for the customer</option>
              {Object.entries(QUOTATION_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </AutoSelect>
            {(q || status) && (
              <Link href="/quotations" className="text-xs font-medium text-muted hover:text-text">
                Reset
              </Link>
            )}
          </FilterBar>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState icon={FileText} title="No quotations found" description="Open an inquiry and choose “Create quotation”." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Quotation</Th>
                <Th>Inquiry</Th>
                <Th className="hidden md:table-cell">Customer</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th className="hidden lg:table-cell">Sent</Th>
                <Th className="hidden sm:table-cell">Valid until</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((r) => {
                const late = r.status === "sent" && r.dueDate < today;
                return (
                  <Tr key={r.id} className="group hover:bg-surface-2/70">
                    <Td className="whitespace-nowrap">
                      <Link href={`/quotations/${r.id}`} className="font-mono text-[13px] font-medium text-text group-hover:text-primary hover:underline">
                        {r.refNo}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted">v{r.version}</span>
                    </Td>
                    <Td className="max-w-72 py-2">
                      <p className="truncate text-text">{r.queryTitle}</p>
                      <Link href={`/queries/${r.queryId}`} className="font-mono text-[11px] text-muted hover:text-primary hover:underline">
                        {r.queryRef}
                      </Link>
                    </Td>
                    <Td className="hidden text-text-2 md:table-cell">{r.companyName}</Td>
                    <Td>
                      <QuotationStatusBadge status={r.status} />
                    </Td>
                    <Td className="text-right font-medium whitespace-nowrap tabular">{formatMoney(r.total, settings.currency)}</Td>
                    <Td className="hidden whitespace-nowrap text-muted lg:table-cell">{formatDate(r.submittedAt)}</Td>
                    <Td className={cn("hidden whitespace-nowrap sm:table-cell", late ? "font-medium text-bad" : "text-text-2")}>{formatDate(r.dueDate)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination base="/quotations" params={{ q, status }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
