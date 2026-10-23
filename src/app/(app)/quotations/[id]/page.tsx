import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { CopyPlus, Pencil, FileDown, Printer, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { deleteQuotationAction, quotationStatusAction, reviseQuotationAction } from "@/modules/quotations/actions";
import { QuotationStatusForm } from "@/modules/quotations/components";
import { isEditable, QUOTATION_TRANSITIONS } from "@/modules/quotations/workflow";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { ButtonLink, buttonClass, Card, CardBody, CardHeader } from "@/components/ui";
import { InvoiceStatusBadge, QuotationStatusBadge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/client";
import { DocumentView, docDate } from "@/components/documents/document-view";
import { formatDate, formatDateTime, todayISO } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";

export const metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = isUuid(id) ? await getQuotationDetail(user, id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const { quotation: q, query, customer } = detail;
  const manage = can(user.role, "quotations.manage");
  const activeInvoice = detail.invoices.find((i) => i.status !== "cancelled");
  const today = todayISO();
  const late = q.status === "sent" && q.dueDate < today;

  return (
    <>
      <header className="no-print mb-5">
        <Link href={`/queries/${query.id}`} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
          ← {query.refNo}: {query.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight text-text">{q.refNo}</h1>
              <span className="text-xs text-muted">v{q.version}</span>
              <QuotationStatusBadge status={q.status} />
            </div>
            <p className="mt-1 text-sm text-muted">
              {customerName(customer)} · {formatMoney(q.total, settings.currency)} · valid until {formatDate(q.dueDate)}
              {late && <span className="ml-2 font-medium text-bad">· expired, no reply yet</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/quotations/${id}/pdf`} className={buttonClass("secondary", "sm")} download>
              <FileDown aria-hidden /> Download PDF
            </a>
            <a href={`/print/quotations/${id}`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
              <Printer aria-hidden /> Print
            </a>
            {manage && isEditable(q.status) && (
              <ButtonLink href={`/quotations/${id}/edit`} variant="secondary" size="sm">
                <Pencil aria-hidden /> Edit
              </ButtonLink>
            )}
            {manage && !isEditable(q.status) && (
              <form action={reviseQuotationAction.bind(null, id)}>
                <ConfirmSubmit variant="secondary" size="sm" message="Make a new draft version with the same lines? This one stays as the customer saw it.">
                  <CopyPlus aria-hidden /> New version
                </ConfirmSubmit>
              </form>
            )}
            {q.status === "accepted" && !activeInvoice && can(user.role, "invoices.manage") && (
              <ButtonLink href={`/invoices/new?quotation=${id}`} variant="primary" size="sm">
                <Receipt aria-hidden /> Generate invoice
              </ButtonLink>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-xl border border-line shadow-card">
          <DocumentView
            kind="Quotation"
            number={q.refNo}
            settings={settings}
            customer={customer}
            stamp={q.status === "draft" ? "Draft" : null}
            meta={[
              { label: "Date", value: docDate(q.submittedAt ?? q.createdAt.toISOString().slice(0, 10)) },
              { label: "Valid until", value: docDate(q.dueDate) },
              { label: "RFQ no.", value: query.refNo },
              ...(q.version > 1 ? [{ label: "Revision", value: `v${q.version}` }] : []),
            ]}
            items={detail.items}
            totals={q}
            terms={q.terms}
          />
        </div>
        <aside className="no-print flex flex-col gap-5">
          {manage && QUOTATION_TRANSITIONS[q.status].length > 0 && (
            <Card>
              <CardHeader
                title="Next step"
                description={q.status === "draft" ? "After you email or WhatsApp it to the customer, mark it as sent." : "Record the customer's answer."}
              />
              <CardBody>
                <QuotationStatusForm action={quotationStatusAction.bind(null, id)} transitions={QUOTATION_TRANSITIONS[q.status]} />
              </CardBody>
            </Card>
          )}
          {detail.invoices.length > 0 && (
            <Card>
              <CardHeader title="Invoice" />
              <CardBody className="flex flex-col gap-2 text-sm">
                {detail.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2">
                    <Link href={`/invoices/${inv.id}`} className="font-mono text-[13px] font-medium text-text hover:text-primary hover:underline">
                      {inv.invoiceNo}
                    </Link>
                    <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="flex flex-col divide-y divide-line text-sm">
                <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-muted">Prepared by</dt>
                  <dd className="text-text">{detail.creatorName}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-muted">Created</dt>
                  <dd className="text-text">{formatDateTime(q.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-muted">Sent to customer</dt>
                  <dd className="text-text">{formatDate(q.submittedAt)}</dd>
                </div>
              </dl>
              {q.notes && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-wrap text-text-2">{q.notes}</p>}
            </CardBody>
          </Card>
          {detail.versions.length > 1 && (
            <Card>
              <CardHeader title="All versions" />
              <CardBody className="flex flex-col gap-2 text-sm">
                {detail.versions.map((v) => (
                  <Link key={v.id} href={`/quotations/${v.id}`} aria-current={v.id === id ? "page" : undefined} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-surface-2 aria-[current=page]:bg-primary-soft">
                    <span>
                      v{v.version} · <span className="tabular">{formatMoney(v.total, settings.currency)}</span>
                    </span>
                    <QuotationStatusBadge status={v.status} />
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
          {manage && q.status === "draft" && (
            <form action={deleteQuotationAction.bind(null, id)} className="text-right">
              <ConfirmSubmit variant="danger-ghost" size="sm" message="Delete this draft quotation?">
                Delete draft
              </ConfirmSubmit>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
