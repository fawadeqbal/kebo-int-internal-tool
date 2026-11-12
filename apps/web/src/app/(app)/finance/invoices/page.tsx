import Link from "next/link";
import { FileText } from "lucide-react";
import { buildHref, Card, EmptyState, LinkTabs, PageHeader, Pager, PhoneList, PhoneRow, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import type { CustomerInvoices } from "@/lib/types-money";
import { invoiceHref } from "@/lib/requests";

export const metadata = { title: "Invoices" };

type Row = CustomerInvoices["rows"][number];
type Chip = "all" | "unpaid" | "part_paid" | "paid";

const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "part_paid", label: "Part paid" },
  { key: "paid", label: "Paid" },
];
const KIND = { proforma: "Proforma invoice", commercial: "Commercial invoice" } as const;
const WORDS = { unpaid: "Unpaid", part_paid: "Part paid", paid: "Paid" } as const;

const PAGE = 20;

/** Where the invoice stands, in plain words, with what needs attention under it. */
function Status({ r }: { r: Row }) {
  return (
    <span className="block text-sm">
      <span className={r.status === "paid" ? "font-medium text-ok" : "font-medium"}>{WORDS[r.status]}</span>
      {r.status !== "paid" &&
        (r.late > 0 ? (
          <span className="block text-xs font-medium text-bad">
            {r.late} day{r.late === 1 ? "" : "s"} late
          </span>
        ) : (
          <span className="block text-xs text-muted">
            {money(r.due, r.currency)} still due{r.nextDue ? ` · next ${date(r.nextDue)}` : ""}
          </span>
        ))}
    </span>
  );
}

/**
 * Finance › Invoices (claude/payments-design.md): each order's invoice as the customer knows it (the
 * commercial invoice once it is made, the proforma before), with what was paid. Paid is worked out from
 * the payments; nobody types it.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; mine?: string; page?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const all = (await api.get<CustomerInvoices>("/billing/customer-invoices", { mine: sp.mine === "1" ? "true" : undefined })).rows;
  const chip: Chip = CHIPS.some((c) => c.key === sp.status) ? (sp.status as Chip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = all.filter((r) => chip === "all" || r.status === chip).filter((r) => !q || [r.invoice.number, r.order.refNo, r.customer.name].join(" ").toLowerCase().includes(q));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { status: chip === "all" ? undefined : chip, q: sp.q, mine: sp.mine === "1" ? "1" : undefined };
  const href = (p: Record<string, string | undefined>) => buildHref("/finance/invoices", keep, { ...p, page: undefined });

  return (
    <div>
      <PageHeader crumbs={crumbsFor("/finance/invoices")} icon={FileText} title="Invoices" summary="Proforma and commercial invoices to customers, with what was paid" />
      <LinkTabs
        label="Which invoices"
        className="mb-4"
        tabs={CHIPS.map((c) => ({
          href: href({ status: c.key === "all" ? undefined : c.key }),
          label: c.label,
          count: c.key === "unpaid" || c.key === "part_paid" ? all.filter((r) => r.status === c.key).length || undefined : undefined,
          active: chip === c.key,
        }))}
      />
      <FilterCard
        search="Search invoice, order, customer…"
        value={sp.q}
        keep={{ status: keep.status }}
        clearHref={href({ q: undefined })}
        selects={[{ name: "mine", label: "Whose orders", value: sp.mine, options: [{ value: "1", label: "My orders" }] }]}
      />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          <EmptyState
            framed
            title={all.length ? "No invoice matches" : "No invoices yet"}
            description={all.length ? "Clear the search or choose All." : "An order shows here once its proforma invoice is issued."}
          />
        ) : (
          <>
            <PhoneList label="Invoices">
              {shown.map((r) => (
                <PhoneRow
                  key={r.order.id}
                  href={invoiceHref(r.order.id)}
                  title={r.customer.name}
                  line={`${r.invoice.number} · ${r.order.refNo}`}
                  status={<span className={r.status === "paid" ? "font-medium text-ok" : r.late > 0 ? "font-medium text-bad" : "font-medium text-text"}>{WORDS[r.status]}</span>}
                  figure={money(r.total, r.currency)}
                />
              ))}
            </PhoneList>
            <div className="hidden overflow-x-auto sm:block">
              <Table className="min-w-[820px]">
                <THead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Customer · order</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Paid</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {shown.map((r) => (
                    <Tr key={r.order.id}>
                      <Td>
                        <Link href={invoiceHref(r.order.id)} className="font-medium whitespace-nowrap hover:text-primary">
                          {r.invoice.number}
                        </Link>
                        <span className="block text-xs text-muted">{KIND[r.invoice.kind]}</span>
                      </Td>
                      <Td>
                        <Link href={`/customers/${r.customer.id}`} className="hover:text-primary">
                          {r.customer.name}
                        </Link>
                        <span className="block text-xs text-muted">
                          <Link href={`/orders/${r.order.id}`} className="hover:underline">
                            {r.order.refNo}
                          </Link>
                          {r.lookedAfterBy ? ` · ${r.lookedAfterBy.name}` : ""}
                        </span>
                      </Td>
                      <Td className="text-sm whitespace-nowrap">{date(r.invoice.issuedOn)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{money(r.total, r.currency)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{money(r.paid, r.currency)}</Td>
                      <Td>
                        <Status r={r} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
        <Pager base="/finance/invoices" params={keep} page={page} pageSize={PAGE} total={rows.length} />
      </Card>
    </div>
  );
}
