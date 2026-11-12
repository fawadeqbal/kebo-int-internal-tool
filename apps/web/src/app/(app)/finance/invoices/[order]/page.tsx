import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { buttonClass, Card, CardHeader, cn, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { UUID } from "@/lib/ids";
import { load, requireUser } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money } from "@/lib/format";
import type { CustomerInvoice } from "@/lib/types-money";
import { RequestStatus } from "@/components/money/requests";
import { requestHref } from "@/lib/requests";

export const metadata = { title: "Invoice" };

const WORDS = { unpaid: "Unpaid", part_paid: "Part paid", paid: "Paid" } as const;
const grouped = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The invoice of an order, its own view (claude/payments-design.md): what it bills (the items), then how
 * it is paid (the parts, each a request with where it stands). Payments and receipts are not repeated
 * here: they are on each request.
 */
export default async function InvoicePage({ params }: { params: Promise<{ order: string }> }) {
  const { order } = await params;
  if (!UUID.test(order)) notFound();
  await requireUser();
  const v = await load(() => api.get<CustomerInvoice>(`/billing/customer-invoices/${order}`));
  const c = v.currency;
  const here = `/finance/invoices/${order}`;
  const inv = v.invoice;
  const proforma = !inv || inv.kind === "proforma";
  const print = proforma ? `/print/orders/${order}/proforma?back=${encodeURIComponent(here)}` : `/print/orders/${order}/commercial-invoice?back=${encodeURIComponent(here)}`;
  const kv = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="shrink-0 text-text-2">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
  const sec = "flex flex-col gap-2 border-t border-line px-5 py-4 first:border-t-0";
  const link = "text-primary hover:underline";

  return (
    <div>
      <PageHeader
        crumbs={[...crumbsFor("/finance/invoices").map((x, i) => (i === 1 ? { ...x, href: "/finance/invoices" } : x)), { label: inv?.number ?? v.order.refNo }]}
        icon={FileText}
        title={inv ? `${proforma ? "Proforma invoice" : "Commercial invoice"} ${inv.number}` : `Invoice of ${v.order.refNo}`}
        summary={
          <>
            <Link href={`/customers/${v.customer.id}`} className="hover:text-primary">
              {v.customer.name}
            </Link>{" "}
            ·{" "}
            <Link href={`/orders/${order}`} className="hover:text-primary">
              {v.order.refNo}
            </Link>{" "}
            {inv ? ` · issued ${date(inv.issuedOn)}${inv.version > 1 ? ` · version ${inv.version}` : ""}` : ""}
          </>
        }
        badge={<span className={cn("text-sm font-medium", v.status === "paid" && "text-ok", !inv && "text-muted")}>{inv ? WORDS[v.status] : "Not issued yet"}</span>}
        actions={
          inv ? (
            <a href={print} className={buttonClass("secondary", "sm")}>
              View / Print
            </a>
          ) : undefined
        }
      />

      {!inv && (
        <section aria-label="Do next" className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
            <span className="text-xs font-semibold text-action">Do next</span>
            <span className="text-[17px] leading-snug font-bold">Issue the proforma invoice</span>
            <span className="text-[13px] text-text-2">It gets its number when it is issued, and asks for the deposit. Below is what it will bill.</span>
          </div>
          <Link href={`/orders/${order}/documents`} className={buttonClass("primary", "md", "max-sm:w-full")}>
            Open the order&rsquo;s papers
          </Link>
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader title="Items" />
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Unit price</Th>
                    <Th className="text-right">Amount {c}</Th>
                  </tr>
                </THead>
                <tbody>
                  {v.lines.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <span className="font-medium">{l.description.split(/\r?\n/)[0]}</span>
                        {l.model && <span className="block text-xs text-muted">{l.model}</span>}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">
                        {qty(l.quantity)} {l.unit}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">{grouped(l.unitPrice)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{grouped(l.amount)}</Td>
                    </Tr>
                  ))}
                  {v.discount && (
                    <Tr>
                      <Td colSpan={3} className="text-text-2">
                        Discount
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">– {grouped(v.discount)}</Td>
                    </Tr>
                  )}
                  {Number(v.charged) > 0 && (
                    <Tr>
                      <Td colSpan={3} className="text-text-2">
                        Charged to the customer (expenses)
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">{grouped(v.charged)}</Td>
                    </Tr>
                  )}
                  <Tr>
                    <Td colSpan={3} className="font-bold">
                      Total
                    </Td>
                    <Td className="text-right font-bold whitespace-nowrap tabular">{grouped(v.total)}</Td>
                  </Tr>
                </tbody>
              </Table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="How it is paid" description="Payments and receipts are on each request." />
            {v.parts.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted">No plan yet. Choose how the customer pays on the order&rsquo;s Payment step.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <Th>Part</Th>
                      <Th>Request</Th>
                      <Th>Due</Th>
                      <Th className="text-right">Amount {c}</Th>
                      <Th>Status</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {v.parts.map((p) => (
                      <Tr key={p.ref}>
                        <Td className="font-medium">{p.label}</Td>
                        <Td className="whitespace-nowrap">
                          <Link href={requestHref(order, p.ref)} className={link}>
                            {p.number}
                          </Link>
                        </Td>
                        <Td className="text-sm whitespace-nowrap">{p.dueOn ? date(p.dueOn) : p.rule ? `${p.rule.charAt(0).toUpperCase()}${p.rule.slice(1)}` : "No date yet"}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{grouped(p.amount)}</Td>
                        <Td>
                          {p.request.state === "paid" ? (
                            <span className="text-sm font-medium text-ok">Paid{p.lastPaidOn ? ` ${date(p.lastPaidOn)}` : ""}</span>
                          ) : (
                            <>
                              <RequestStatus r={p.request} late={p.late} />
                              {Number(p.paid) > 0 && <span className="block text-xs text-muted">{money(p.paid, c)} received</span>}
                            </>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-sm">
              <span className="text-muted">
                Total <span className="font-semibold text-text tabular">{money(v.total, c)}</span>
              </span>
              <span className="text-muted">
                Paid <span className="font-semibold text-ok tabular">{money(v.paid, c)}</span>
              </span>
              <span className="text-muted">
                Still due <span className="font-semibold text-text tabular">{money(v.due, c)}</span>
              </span>
            </div>
          </Card>
        </div>

        <Card aria-label="Beside the invoice">
          <dl className={sec}>
            <dt className="mb-0.5 text-sm font-bold">Terms</dt>
            {v.terms.priceBasis && kv("Price basis", v.terms.priceBasis)}
            <div className="flex flex-col gap-1 text-sm">
              <dt className="text-text-2">Payment</dt>
              <dd className="font-semibold">{v.terms.payment}</dd>
            </div>
          </dl>
          <dl className={sec}>
            <dt className="mb-0.5 text-sm font-bold">Linked</dt>
            {v.linked.quotation &&
              kv(
                "Quotation",
                <Link href={`/inquiries/${v.linked.quotation.inquiryId}/quotation`} className={link}>
                  {v.linked.quotation.refNo} R{v.linked.quotation.revision}
                </Link>,
              )}
            {kv(
              "Sales order",
              <Link href={`/orders/${order}`} className={link}>
                {v.order.refNo}
              </Link>,
            )}
            {!proforma &&
              v.linked.proforma &&
              kv(
                "Proforma invoice",
                <a href={`/print/orders/${order}/proforma?back=${encodeURIComponent(here)}`} className={link}>
                  {v.linked.proforma.number}
                </a>,
              )}
            {proforma && kv("Commercial invoice", <span className="font-normal text-text-2">when it ships</span>)}
          </dl>
          {inv && (
            <dl className={sec}>
              <dt className="mb-0.5 text-sm font-bold">Kept as issued</dt>
              {kv(`Version ${inv.version}`, date(inv.issuedOn))}
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
