import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { Download, Eye, FileText, Mail, MessageCircle, Paperclip, Phone, Pencil, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils/ids";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { getQueryDetail } from "@/modules/queries/repository";
import { canWorkOn } from "@/modules/queries/service";
import { OPEN_STATUSES, timeInStatus, TRANSITIONS, turnaroundMs } from "@/modules/queries/workflow";
import { addCommentAction, assignQueryAction, changeStatusAction, deleteQueryAction, removeAttachmentAction } from "@/modules/queries/actions";
import { AssignPanel, CommentForm, RemoveFileButton, StatusPanel } from "@/modules/queries/components/panels";
import { AttachmentUploader } from "@/modules/queries/components/uploader";
import { listActiveUsers } from "@/modules/users/repository";
import { Avatar, buttonClass, ButtonLink, Card, CardBody, CardHeader, DetailList, EmptyState, Table, THead, Td, Th, Tr } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { DealTrack } from "@/modules/queries/components/inbox";
import { InvoiceStatusBadge, PriorityBadge, QueryStatusBadge, QuotationStatusBadge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/client";
import { QUERY_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDateTime, formatDuration, todayISO } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";
import { getSettings } from "@/modules/settings/service";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import type { QueryStatus } from "@/lib/db/schema";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Inquiry ${(await params).id.slice(0, 8)}` };
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function QueryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = isUuid(id) ? await getQueryDetail(user, id) : null;
  if (!detail) notFound();
  const [people, settings] = await Promise.all([listActiveUsers(), getSettings()]);

  const { query, customer } = detail;
  const workable = canWorkOn(user, query);
  const isManager = can(user.role, "queries.updateAny");
  const transitions = workable ? TRANSITIONS[query.status].filter((t) => !t.reopen || isManager) : [];
  const today = todayISO();
  const overdue = !!query.requiredBy && query.requiredBy < today && OPEN_STATUSES.includes(query.status);
  const durations = timeInStatus(detail.history.map((h) => ({ toStatus: h.toStatus, changedAt: new Date(h.changedAt) })));
  const isClosed = !OPEN_STATUSES.includes(query.status);

  type Event = { at: Date; text: React.ReactNode; detail?: string | null; kind: string };
  const events: Event[] = [
    ...detail.history.map((h) => ({
      at: new Date(h.changedAt),
      kind: "status",
      text: h.fromStatus ? (
        <>
          <b>{h.userName}</b> changed status from {QUERY_STATUS_LABEL[h.fromStatus]} to <b>{QUERY_STATUS_LABEL[h.toStatus]}</b>
        </>
      ) : (
        <>
          <b>{h.userName}</b> created the inquiry
        </>
      ),
      detail: h.reason,
    })),
    ...detail.assignments.map((a) => ({
      at: new Date(a.assignedAt),
      kind: "assign",
      text: (
        <>
          <b>{a.byName}</b> {a.toName ? <>assigned it to <b>{a.toName}</b></> : "removed the assignment"}
        </>
      ),
    })),
    ...detail.files.map((f) => ({
      at: new Date(f.createdAt),
      kind: "file",
      text: (
        <>
          <b>{f.uploadedBy}</b> uploaded {f.fileName}
        </>
      ),
    })),
    ...detail.quotations.map((q) => ({
      at: new Date(q.createdAt),
      kind: "quotation",
      text: (
        <>
          Quotation <b>{q.refNo}</b> (v{q.version}) created
        </>
      ),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      {/* Header */}
      <header className="mb-5">
        <Link href="/queries" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text">
          ← Inquiries
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 font-mono text-xs font-medium text-muted">{query.refNo}</span>
              <QueryStatusBadge status={query.status} />
              {query.priority !== "normal" && <PriorityBadge priority={query.priority} />}
              {overdue && <Badge tone="bad">Overdue</Badge>}
              {query.source === "website" && <Badge tone="primary">Website</Badge>}
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-text">{query.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {customerName(customer)} · received {formatDateTime(query.createdAt)} via {SOURCE_LABEL[query.source].toLowerCase()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workable && (
              <ButtonLink href={`/queries/${id}/edit`} variant="secondary" size="sm">
                <Pencil aria-hidden /> Edit
              </ButtonLink>
            )}
            {can(user.role, "quotations.manage") && query.status !== "not_completed" && (
              <ButtonLink href={`/quotations/new?query=${id}`} variant="primary" size="sm">
                <FileText aria-hidden /> {detail.quotations.length ? "New quotation version" : "Create quotation"}
              </ButtonLink>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          <DealTrack
            status={query.status}
            quoted={detail.quotations.some((q) => q.status !== "draft")}
            accepted={detail.quotations.some((q) => q.status === "accepted")}
            invoiced={detail.invoices.some((i) => i.status !== "cancelled")}
          />
          <span className="text-xs text-muted">
            {isClosed ? "Turnaround" : "Open for"}{" "}
            <span className="font-medium text-text tabular">{formatDuration(turnaroundMs(new Date(query.createdAt), query.completedAt ? new Date(query.completedAt) : null))}</span>
            {query.requiredBy && (
              <>
                {" "}
                · needed by <span className={overdue ? "font-medium text-bad" : "font-medium text-text"}>{formatDate(query.requiredBy)}</span>
              </>
            )}
          </span>
        </div>
        {query.statusReason && isClosed && (
          <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <span className="font-medium">Reason:</span> {query.statusReason}
          </p>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:items-start">
        {/* What to do next: first on a phone, top right on a desktop */}
        <aside aria-label="Status and assignment" className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1">
          <Card>
            <CardHeader
              title="Status"
              description={
                !workable
                  ? "Only the person handling it or a manager can change this."
                  : transitions.length === 0
                    ? "Closed. A manager can reopen it."
                    : "Move it to the next step."
              }
            />
            <CardBody>
              <div className="mb-3 flex items-center gap-2 text-sm text-muted">
                Now <QueryStatusBadge status={query.status} />
              </div>
              {workable && transitions.length > 0 && <StatusPanel action={changeStatusAction.bind(null, id)} transitions={transitions} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Handled by" />
            <CardBody className="flex flex-col gap-3">
              {detail.assigneeName ? (
                <p className="flex items-center gap-2 text-sm font-medium text-text">
                  <Avatar name={detail.assigneeName} size={26} />
                  {detail.assigneeName}
                </p>
              ) : (
                <p>
                  <Badge tone="warn">Not assigned yet</Badge>
                </p>
              )}
              <AssignPanel
                action={assignQueryAction.bind(null, id)}
                people={people}
                current={query.assignedTo}
                canAssignOthers={can(user.role, "queries.assign")}
                currentUserId={user.id}
              />
            </CardBody>
          </Card>

        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader title="Requirements" description={`${query.category ? `${query.category} · ` : ""}Quantity ${query.quantity}`} />
            <CardBody>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-text">{query.specifications}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Files (${detail.files.length})`} description="Drawings, spec sheets, photos and factory quotes." />
            <CardBody className="flex flex-col gap-4">
              {detail.files.length > 0 && (
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {detail.files.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                        <Paperclip className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-text">{f.fileName}</span>
                        <span className="text-xs text-muted">
                          {formatBytes(f.size)} · {f.uploadedBy} · {formatDateTime(f.createdAt)}
                        </span>
                      </span>
                      {["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(f.mimeType) && (
                        <a href={`/api/attachments/${f.id}?view=1`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "xs")}>
                          <Eye aria-hidden /> View
                        </a>
                      )}
                      <a href={`/api/attachments/${f.id}`} className={buttonClass("ghost", "xs")}>
                        <Download aria-hidden /> Download
                      </a>
                      {(isManager || f.uploaderId === user.id) && <RemoveFileButton action={removeAttachmentAction.bind(null, f.id)} fileName={f.fileName} />}
                    </li>
                  ))}
                </ul>
              )}
              <AttachmentUploader queryId={id} maxMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} />
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Quotations & invoices" />
            {detail.quotations.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No quotation yet"
                description="When the factory price is in, quote the customer."
                action={
                  can(user.role, "quotations.manage") &&
                  query.status !== "not_completed" && (
                    <ButtonLink href={`/quotations/new?query=${id}`} variant="primary" size="sm">
                      Create quotation
                    </ButtonLink>
                  )
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Document</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="hidden sm:table-cell">Due</Th>
                  </tr>
                </THead>
                <tbody>
                  {detail.quotations.map((q) => (
                    <Tr key={q.id} className="hover:bg-surface-2/70">
                      <Td>
                        <Link href={`/quotations/${q.id}`} className="font-mono text-[13px] font-medium text-text hover:text-primary hover:underline">
                          {q.refNo}
                        </Link>
                        <span className="ml-2 text-xs text-muted">Quotation v{q.version}</span>
                      </Td>
                      <Td>
                        <QuotationStatusBadge status={q.status} />
                      </Td>
                      <Td className="text-right font-medium whitespace-nowrap tabular">{formatMoney(q.total, settings.currency)}</Td>
                      <Td className="hidden text-text-2 sm:table-cell">{formatDate(q.dueDate)}</Td>
                    </Tr>
                  ))}
                  {(can(user.role, "invoices.manage") ? detail.invoices : []).map((inv) => (
                    <Tr key={inv.id} className="hover:bg-surface-2/70">
                      <Td>
                        <Link href={`/invoices/${inv.id}`} className="font-mono text-[13px] font-medium text-text hover:text-primary hover:underline">
                          {inv.invoiceNo}
                        </Link>
                        <span className="ml-2 text-xs text-muted">Invoice</span>
                      </Td>
                      <Td>
                        <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                      </Td>
                      <Td className="text-right font-medium whitespace-nowrap tabular">{formatMoney(inv.total, settings.currency)}</Td>
                      <Td className="hidden text-text-2 sm:table-cell">{formatDate(inv.dueDate)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Internal notes" description="Only the team sees these." />
            <CardBody className="flex flex-col gap-5">
              <CommentForm action={addCommentAction.bind(null, id)} />
              {detail.notes.length > 0 && (
                <ol className="flex flex-col gap-4">
                  {detail.notes.map((n) => (
                    <li key={n.id} className="flex gap-3">
                      <Avatar name={n.authorName} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium text-text">{n.authorName}</span> <span className="ml-1 text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                        </p>
                        <p className="mt-0.5 text-sm whitespace-pre-wrap text-text-2">{n.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Customer, timing and history */}
        <aside aria-label="Details" className="flex flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <Card>
            <CardHeader title="Customer" actions={<Link href={`/customers/${customer.id}`} className="text-xs font-medium text-primary hover:underline">View</Link>} />
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={customer.contactPerson} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{customer.contactPerson}</p>
                  <p className="truncate text-xs text-muted">{customer.companyName ?? "No company"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a href={`tel:${customer.phone}`} className={buttonClass("secondary", "xs")}>
                  <Phone aria-hidden /> Call
                </a>
                <a href={`https://wa.me/${customer.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "xs")}>
                  <MessageCircle aria-hidden /> WhatsApp
                </a>
                {customer.email && (
                  <a href={`mailto:${customer.email}?subject=${encodeURIComponent(`${query.refNo}: ${query.title}`)}`} className={buttonClass("secondary", "xs")}>
                    <Mail aria-hidden /> Email
                  </a>
                )}
              </div>
              <DetailList
                columns={1}
                items={[
                  { label: "Phone / WhatsApp", value: <span className="tabular">{customer.phone}</span> },
                  { label: "Email", value: customer.email, hidden: !customer.email },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Time taken" />
            <CardBody>
              <dl className="flex flex-col divide-y divide-line text-sm">
                <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-muted">Needed by</dt>
                  <dd className={overdue ? "font-medium text-bad" : "text-text"}>{formatDate(query.requiredBy)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-muted">{isClosed ? "Turnaround" : "Open for"}</dt>
                  <dd className="font-medium text-text tabular">{formatDuration(turnaroundMs(new Date(query.createdAt), query.completedAt ? new Date(query.completedAt) : null))}</dd>
                </div>
                {(Object.keys(QUERY_STATUS_LABEL) as QueryStatus[])
                  .filter((s) => durations[s] !== undefined && !["completed", "not_completed"].includes(s))
                  .map((s) => (
                    <div key={s} className="flex justify-between gap-3 py-2">
                      <dt className="text-muted">Time in {QUERY_STATUS_LABEL[s]}</dt>
                      <dd className="tabular">{formatDuration(durations[s])}</dd>
                    </div>
                  ))}
                <div className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <dt className="text-muted">Created by</dt>
                  <dd>{detail.creatorName}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <ol className="relative flex flex-col gap-4 border-l border-line pl-4">
                {events.map((e, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary ring-4 ring-surface" aria-hidden />
                    <p className="text-text-2 [&_b]:font-medium [&_b]:text-text">{e.text}</p>
                    {e.detail && <p className="mt-0.5 text-muted">“{e.detail}”</p>}
                    <p className="text-xs text-muted">{formatDateTime(e.at)}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {can(user.role, "queries.delete") && detail.invoices.length === 0 && (
            <form action={deleteQueryAction.bind(null, id)} className="text-right">
              <ConfirmSubmit variant="danger-ghost" size="sm" message={`Remove inquiry ${query.refNo}? It will be hidden from all lists.`}>
                <Trash2 aria-hidden /> Remove inquiry
              </ConfirmSubmit>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
