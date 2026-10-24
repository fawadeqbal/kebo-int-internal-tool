import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { FileDown, Printer } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { cancelInvoiceAction, recordPaymentAction } from "@/modules/invoices/actions";
import { CancelInvoiceForm, PaymentForm } from "@/modules/invoices/components";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { listPackingListsForQuery } from "@/modules/packing/repository";
import { formatCbm, formatKg } from "@/lib/packing";
import { buttonClass, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { InvoiceStatusBadge } from "@/components/ui/badge";
import { InvoiceDocument } from "@/components/documents/documents";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { id } = await params;
  const detail = isUuid(id) ? await getInvoiceDetail(id) : null;
  if (!detail) notFound();
  const [settings, allPacking] = await Promise.all([getSettings(), listPackingListsForQuery(detail.query.id)]);
  const packing = allPacking.filter((p) => p.invoiceId === id);
  const { invoice: inv, customer, query, quotation } = detail;
  const today = todayISO();
  const display = invoiceDisplayStatus(inv, today);
  const balance = toCents(inv.total) - toCents(inv.amountPaid);
  const open = inv.status === "unpaid" || inv.status === "partially_paid";

  return (
    <div>
      <header className="no-print mb-5">
        <Link href="/invoices" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
          ← Invoices
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight text-text">{inv.invoiceNo}</h1>
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
          <div className="flex flex-wrap gap-2">
            <a href={`/print/invoices/${id}`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
              <Printer aria-hidden /> Print
            </a>
            <a href={`/api/invoices/${id}/pdf`} className={buttonClass("primary", "sm")} download>
              <FileDown aria-hidden /> Download PDF
            </a>
          </div>
        </div>
        {inv.status === "cancelled" && (
          <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <span className="font-medium">Cancelled:</span> {inv.cancelReason}
          </p>
        )}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-[auto_1fr] xl:items-start">
        <aside aria-label="Next step" className="no-print flex flex-col gap-5 empty:hidden xl:col-start-2 xl:row-start-1">
          <Card>
            <CardHeader title="Payment" description={inv.status === "paid" ? "Paid in full" : `Due ${formatDate(inv.dueDate)}`} />
            <CardBody className="flex flex-col gap-4">
              <dl className="flex flex-col divide-y divide-line text-sm">
                <div className="flex justify-between py-2 first:pt-0">
                  <dt className="text-muted">Total</dt>
                  <dd className="text-text tabular">{formatMoney(inv.total, settings.currency)}</dd>
                </div>
                <div className="flex justify-between py-2 first:pt-0">
                  <dt className="text-muted">Received</dt>
                  <dd className="text-text tabular">{formatMoney(inv.amountPaid, settings.currency)}</dd>
                </div>
                <div className="flex justify-between pt-2 font-medium text-text">
                  <dt>Balance due</dt>
                  <dd className={display === "overdue" ? "tabular text-bad" : "tabular"}>
                    {inv.status === "cancelled" ? "—" : formatCents(balance, settings.currency)}
                  </dd>
                </div>
              </dl>
              {open && can(user.role, "payments.record") && (
                <PaymentForm action={recordPaymentAction.bind(null, id)} balance={formatCents(balance, settings.currency)} today={today} />
              )}
            </CardBody>
          </Card>
        </aside>
        <div className="overflow-hidden rounded-xl border border-line shadow-card xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <InvoiceDocument detail={detail} settings={settings} />
        </div>
        <aside aria-label="Details" className="no-print flex flex-col gap-5 xl:col-start-2 xl:row-start-2">
          {inv.status !== "cancelled" && (
            <Card>
              <CardHeader
                title="Packing lists"
                actions={
                  <ButtonLink href={`/packing-lists/new?invoice=${id}`} variant="secondary" size="sm">
                    New
                  </ButtonLink>
                }
              />
              <CardBody>
                {packing.length === 0 ? (
                  <p className="text-sm text-muted">None yet. Make one when the goods are packed.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line text-sm">
                    {packing.map((p) => (
                      <li key={p.id} className="py-2 first:pt-0 last:pb-0">
                        <Link href={`/packing-lists/${p.id}`} className="flex justify-between gap-3 hover:underline">
                          <span className="font-mono font-medium text-text">{p.plNo}</span>
                          <span className="text-muted">{formatDate(p.packDate)}</span>
                        </Link>
                        <p className="text-xs text-muted tabular">
                          {p.packages} pkgs · {formatKg(Number(p.grossWeight))} · {formatCbm(Number(p.cbm))}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
          {detail.payments.length > 0 && (
            <Card>
              <CardHeader title="Payments received" />
              <CardBody>
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <span>
                        <span className="block font-medium text-text tabular">{formatMoney(p.amount, settings.currency)}</span>
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
    </div>
  );
}
