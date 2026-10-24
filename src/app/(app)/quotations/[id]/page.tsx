import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { CopyPlus, Pencil, FileDown, Printer, Receipt } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/utils/ids";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { deleteQuotationAction, quotationStatusAction, reviseQuotationAction } from "@/modules/quotations/actions";
import { QuotationStatusForm } from "@/modules/quotations/components";
import { quotationAbilities, quotationChanges } from "@/modules/documents/abilities";
import { RevisionChanges } from "@/modules/quotations/revision-changes";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { getSettings } from "@/modules/settings/service";
import { ButtonLink, buttonClass, Card, CardBody, CardHeader } from "@/components/ui";
import { InvoiceStatusBadge, QuotationStatusBadge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/client";
import { QuotationDocument } from "@/components/documents/documents";
import { formatDate, formatDateTime, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { costSummary } from "@/lib/costing";
import { can } from "@/lib/auth/permissions";

export const metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = isUuid(id) ? await getQuotationDetail(user, id) : null;
  if (!detail) notFound();
  const settings = await getSettings();
  const { quotation: q, query, customer } = detail;
  const able = quotationAbilities(user, detail);
  const changes = quotationChanges(detail);
  const costing = costSummary(detail.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost })));
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
              {detail.superseded ? <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-muted">Superseded</span> : <QuotationStatusBadge status={q.status} />}
            </div>
            <p className="mt-1 text-sm text-muted">
              {customerName(customer)} · {formatMoney(q.total, q.currency)} · valid until {formatDate(q.dueDate)}
              {late && <span className="ml-2 font-medium text-bad">· expired, no reply yet</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/print/quotations/${id}`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
              <Printer aria-hidden /> Print
            </a>
            <a href={`/api/quotations/${id}/pdf`} className={buttonClass("secondary", "sm")} download>
              <FileDown aria-hidden /> Download PDF
            </a>
            {able.edit && (
              <ButtonLink href={`/quotations/${id}/edit`} variant="secondary" size="sm">
                <Pencil aria-hidden /> Edit
              </ButtonLink>
            )}
            {able.revise && (
              <form action={reviseQuotationAction.bind(null, id)}>
                <ConfirmSubmit variant="secondary" size="sm" message="Make a new draft version with the same lines? This one stays as the customer saw it.">
                  <CopyPlus aria-hidden /> New version
                </ConfirmSubmit>
              </form>
            )}
            {able.invoice && (
              <ButtonLink href={`/invoices/new?quotation=${id}`} variant="primary" size="sm">
                <Receipt aria-hidden /> Generate invoice
              </ButtonLink>
            )}
          </div>
        </div>
        {detail.newer && (
          <p className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-text-2">
            This is version {q.version}. It was replaced by{" "}
            <Link href={`/quotations/${detail.newer.id}`} className="font-medium text-primary hover:underline">
              version {detail.newer.version} ({detail.newer.refNo})
            </Link>
            , which is the one to send, accept or invoice.
          </p>
        )}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-[auto_1fr] xl:items-start">
        <aside aria-label="Next step" className="no-print flex flex-col gap-5 empty:hidden xl:col-start-2 xl:row-start-1">
          {able.transitions.length > 0 && (
            <Card>
              <CardHeader
                title="Next step"
                description={q.status === "draft" ? "After you email or WhatsApp it to the customer, mark it as sent." : "Record the customer's answer."}
              />
              <CardBody>
                <QuotationStatusForm action={quotationStatusAction.bind(null, id)} transitions={able.transitions} />
              </CardBody>
            </Card>
          )}
          {can(user.role, "sourcing.manage") && costing.costCents > 0 && (
            <Card>
              <CardHeader title="Costing" description="Internal, not on the PDF" />
              <CardBody>
                <dl className="flex flex-col divide-y divide-line text-sm">
                  <div className="flex justify-between gap-3 py-2 first:pt-0">
                    <dt className="text-muted">Our cost (incl. VAT)</dt>
                    <dd className="tabular">{formatCents(costing.costCents, q.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-2">
                    <dt className="text-muted">Sold for (before discount)</dt>
                    <dd className="tabular">{formatCents(costing.salesCents, q.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-2 last:pb-0">
                    <dt className="font-medium text-text">Profit</dt>
                    <dd className={costing.profitCents - toCents(q.discount) < 0 ? "font-semibold text-bad tabular" : "font-semibold text-ok tabular"}>
                      {formatCents(costing.profitCents - toCents(q.discount), q.currency)}
                      {costing.salesCents > 0 && ` · ${Math.round(((costing.profitCents - toCents(q.discount)) / costing.salesCents) * 1000) / 10}%`}
                    </dd>
                  </div>
                </dl>
                {costing.uncosted > 0 && <p className="mt-2 text-xs text-muted">{costing.uncosted} line(s) without a cost (e.g. freight) are not counted.</p>}
                {toCents(q.discount) > 0 && <p className="mt-1 text-xs text-muted">The discount is taken off the profit.</p>}
              </CardBody>
            </Card>
          )}
          {detail.previous && (
            <Card>
              <CardHeader title={`Changes from v${detail.previous.version}`} description={`Total ${formatMoney(detail.previous.total, q.currency)} → ${formatMoney(q.total, q.currency)}`} />
              <CardBody>
                <RevisionChanges changes={changes} currency={q.currency} />
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
        </aside>
        <div className="overflow-hidden rounded-xl border border-line shadow-card xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <QuotationDocument detail={detail} settings={settings} />
        </div>
        <aside aria-label="Details" className="no-print flex flex-col gap-5 xl:col-start-2 xl:row-start-2">
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
                      v{v.version} · <span className="tabular">{formatMoney(v.total, q.currency)}</span>
                    </span>
                    {v.version < detail.latestVersion ? <span className="text-xs text-muted">Superseded</span> : <QuotationStatusBadge status={v.status} />}
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
          {able.delete && (
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
