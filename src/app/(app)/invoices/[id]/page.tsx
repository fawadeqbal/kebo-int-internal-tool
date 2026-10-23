import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { Printer } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { cancelInvoiceAction, recordPaymentAction } from "@/modules/invoices/actions";
import { CancelInvoiceForm, PaymentForm } from "@/modules/invoices/components";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { buttonClass, Card, CardBody, CardHeader } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { DocumentView, docDate } from "@/components/documents/document-view";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getInvoiceDetail(id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const { invoice: inv, customer, query, quotation } = detail;
  const today = todayISO();
  const display = invoiceDisplayStatus(inv, today);
  const balance = toCents(inv.total) - toCents(inv.amountPaid);
  const open = inv.status === "unpaid" || inv.status === "partially_paid";

  return (
    <>
      <header className="no-print mb-6">
        <Link href="/invoices" className="mb-2 inline-flex text-sm text-muted hover:text-ink">
          ← Invoices
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{inv.invoiceNo}</h1>
              <InvoiceStatusBadge status={display} />
            </div>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/customers/${customer.id}`} className="hover:underline">
                {customerName(customer)}
              </Link>{" "}
              · from{" "}
              <Link href={`/quotations/${quotation.id}`} className="hover:underline">
                {quotation.refNo}
              </Link>{" "}
              ·{" "}
              <Link href={`/queries/${query.id}`} className="hover:underline">
                {query.refNo}
              </Link>
            </p>
          </div>
          <a href={`/print/invoices/${id}`} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
            <Printer className="h-4 w-4" aria-hidden /> Print / PDF
          </a>
        </div>
        {inv.status === "cancelled" && (
          <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-2 text-sm">
            <span className="font-medium">Cancelled:</span> {inv.cancelReason}
          </p>
        )}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-xl border border-line shadow-xs">
          <DocumentView
            kind="Invoice"
            number={inv.invoiceNo}
            settings={settings}
            customer={customer}
            stamp={inv.status === "cancelled" ? "Cancelled" : inv.status === "paid" ? "Paid" : null}
            meta={[
              { label: "Invoice date", value: docDate(inv.issueDate) },
              { label: "Payment due", value: docDate(inv.dueDate) },
              { label: "Quotation", value: quotation.refNo },
              { label: "RFQ no.", value: query.refNo },
            ]}
            items={detail.items}
            totals={inv}
            terms={inv.notes}
            footer={settings.invoiceFooter}
          />
        </div>
        <aside className="no-print flex flex-col gap-6">
          <Card>
            <CardHeader title="Payment" />
            <CardBody className="flex flex-col gap-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Total</dt>
                  <dd className="tabular-nums">{formatMoney(inv.total, settings.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Received</dt>
                  <dd className="tabular-nums">{formatMoney(inv.amountPaid, settings.currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 font-semibold">
                  <dt>Balance due</dt>
                  <dd className={display === "overdue" ? "tabular-nums text-red-700" : "tabular-nums"}>
                    {inv.status === "cancelled" ? "—" : formatCents(balance, settings.currency)}
                  </dd>
                </div>
              </dl>
              {open && can(user.role, "payments.record") && (
                <PaymentForm action={recordPaymentAction.bind(null, id)} balance={formatCents(balance, settings.currency)} today={today} />
              )}
            </CardBody>
          </Card>
          {detail.payments.length > 0 && (
            <Card>
              <CardHeader title="Payments received" />
              <CardBody>
                <ul className="flex flex-col gap-3 text-sm">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>
                        <span className="block font-medium tabular-nums">{formatMoney(p.amount, settings.currency)}</span>
                        <span className="text-xs text-muted">
                          {PAYMENT_METHOD_LABEL[p.method]}
                          {p.reference ? ` · ${p.reference}` : ""} · by {p.recordedBy}
                        </span>
                      </span>
                      <span className="text-muted">{formatDate(p.paidAt)}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {open && toCents(inv.amountPaid) === 0 && (
            <div className="text-right">
              <CancelInvoiceForm action={cancelInvoiceAction.bind(null, id)} />
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
