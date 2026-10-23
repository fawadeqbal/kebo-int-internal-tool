import Link from "next/link";
import { notFound } from "next/navigation";
import { customerName } from "@/lib/utils/names";
import { Download, Eye, FileText, Mail, Paperclip, Phone, Pencil } from "lucide-react";
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
import { ButtonLink, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import { InvoiceStatusBadge, PriorityBadge, QueryStatusBadge, QuotationStatusBadge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/client";
import { QUERY_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDateTime, formatDuration, todayISO } from "@/lib/utils/dates";
import { formatMoney } from "@/lib/utils/money";
import { getSettings } from "@/modules/settings/service";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import type { QueryStatus } from "@/lib/db/schema";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Query ${(await params).id.slice(0, 8)}` };
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
          <b>{h.userName}</b> created the query
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
      <header className="mb-6">
        <Link href="/queries" className="mb-2 inline-flex text-sm text-muted hover:text-ink">
          ← Queries
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-muted">{query.refNo}</span>
              <QueryStatusBadge status={query.status} />
              <PriorityBadge priority={query.priority} />
              {overdue && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Overdue</span>}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{query.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {customerName(customer)} · received {formatDateTime(query.createdAt)} via {SOURCE_LABEL[query.source].toLowerCase()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workable && (
              <ButtonLink href={`/queries/${id}/edit`} variant="secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </ButtonLink>
            )}
            {can(user.role, "quotations.manage") && query.status !== "not_completed" && (
              <ButtonLink href={`/quotations/new?query=${id}`}>
                <FileText className="h-4 w-4" aria-hidden /> {detail.quotations.length ? "New quotation version" : "Create quotation"}
              </ButtonLink>
            )}
          </div>
        </div>
        {query.statusReason && isClosed && (
          <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-2 text-sm">
            <span className="font-medium">Reason:</span> {query.statusReason}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Specifications" description={`${query.category ? `${query.category} · ` : ""}Quantity ${query.quantity}`} />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{query.specifications}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Files (${detail.files.length})`} description="Drawings, spec sheets and photos for this query." />
            <CardBody className="flex flex-col gap-4">
              {detail.files.length > 0 && (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {detail.files.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                      <Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{f.fileName}</span>
                        <span className="text-xs text-muted">
                          {formatBytes(f.size)} · {f.uploadedBy} · {formatDateTime(f.createdAt)}
                        </span>
                      </span>
                      {["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(f.mimeType) && (
                        <a href={`/api/attachments/${f.id}?view=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                          <Eye className="h-4 w-4" aria-hidden /> View
                        </a>
                      )}
                      <a href={`/api/attachments/${f.id}`} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                        <Download className="h-4 w-4" aria-hidden /> Download
                      </a>
                      {(isManager || f.uploaderId === user.id) && <RemoveFileButton action={removeAttachmentAction.bind(null, f.id)} fileName={f.fileName} />}
                    </li>
                  ))}
                </ul>
              )}
              <AttachmentUploader queryId={id} maxMb={Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Quotations & invoices" />
            {detail.quotations.length === 0 ? (
              <EmptyState
                title="No quotation yet"
                description="When pricing is ready, create a quotation with price, tax and due date."
                action={
                  can(user.role, "quotations.manage") &&
                  query.status !== "not_completed" && <ButtonLink href={`/quotations/new?query=${id}`}>Create quotation</ButtonLink>
                }
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Document</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Due</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.quotations.map((q) => (
                    <tr key={q.id}>
                      <Td>
                        <Link href={`/quotations/${q.id}`} className="font-medium text-brand-700 hover:underline">
                          {q.refNo}
                        </Link>
                        <span className="ml-2 text-xs text-muted">Quotation v{q.version}</span>
                      </Td>
                      <Td>
                        <QuotationStatusBadge status={q.status} />
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(q.total, settings.currency)}</Td>
                      <Td>{formatDate(q.dueDate)}</Td>
                    </tr>
                  ))}
                  {(can(user.role, "invoices.manage") ? detail.invoices : []).map((inv) => (
                    <tr key={inv.id}>
                      <Td>
                        <Link href={`/invoices/${inv.id}`} className="font-medium text-brand-700 hover:underline">
                          {inv.invoiceNo}
                        </Link>
                        <span className="ml-2 text-xs text-muted">Invoice</span>
                      </Td>
                      <Td>
                        <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                      </Td>
                      <Td className="text-right tabular-nums">{formatMoney(inv.total, settings.currency)}</Td>
                      <Td>{formatDate(inv.dueDate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Notes" description="Internal notes for the team. Customers never see these." />
            <CardBody className="flex flex-col gap-5">
              <CommentForm action={addCommentAction.bind(null, id)} />
              {detail.notes.length > 0 && (
                <ol className="flex flex-col gap-4">
                  {detail.notes.map((n) => (
                    <li key={n.id} className="flex gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" aria-hidden>
                        {n.authorName
                          .split(" ")
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-semibold">{n.authorName}</span> <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Side column */}
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Status"
              description={
                !workable
                  ? "Only the assigned person or a manager can change this."
                  : transitions.length === 0
                    ? "This query is closed. A manager can reopen it if needed."
                    : "Move the query forward."
              }
            />
            <CardBody>
              <div className="mb-3 flex items-center gap-2 text-sm">
                Current: <QueryStatusBadge status={query.status} />
              </div>
              {workable && transitions.length > 0 && <StatusPanel action={changeStatusAction.bind(null, id)} transitions={transitions} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Assigned to" />
            <CardBody className="flex flex-col gap-3">
              <p className={query.assignedTo ? "text-sm font-medium" : "text-sm italic text-muted"}>{detail.assigneeName ?? "Nobody yet"}</p>
              <AssignPanel
                action={assignQueryAction.bind(null, id)}
                people={people}
                current={query.assignedTo}
                canAssignOthers={can(user.role, "queries.assign")}
                currentUserId={user.id}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer" actions={<Link href={`/customers/${customer.id}`} className="text-sm text-brand-700 hover:underline">View</Link>} />
            <CardBody className="flex flex-col gap-2 text-sm">
              <p className="font-semibold">{customerName(customer)}</p>
              <p>{customer.contactPerson}</p>
              <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-2 text-brand-700 hover:underline">
                <Phone className="h-4 w-4" aria-hidden /> {customer.phone}
              </a>
              {customer.email && (
                <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-2 break-all text-brand-700 hover:underline">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden /> {customer.email}
                </a>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Timing" />
            <CardBody>
              <dl className="flex flex-col gap-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Required by</dt>
                  <dd className={overdue ? "font-semibold text-red-700" : ""}>{formatDate(query.requiredBy)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{isClosed ? "Turnaround" : "Open for"}</dt>
                  <dd className="font-semibold tabular-nums">{formatDuration(turnaroundMs(new Date(query.createdAt), query.completedAt ? new Date(query.completedAt) : null))}</dd>
                </div>
                {(Object.keys(QUERY_STATUS_LABEL) as QueryStatus[])
                  .filter((s) => durations[s] !== undefined && !["completed", "not_completed"].includes(s))
                  .map((s) => (
                    <div key={s} className="flex justify-between gap-3">
                      <dt className="text-muted">Time in {QUERY_STATUS_LABEL[s]}</dt>
                      <dd className="tabular-nums">{formatDuration(durations[s])}</dd>
                    </div>
                  ))}
                <div className="flex justify-between gap-3">
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
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-surface" aria-hidden />
                    <p>{e.text}</p>
                    {e.detail && <p className="mt-0.5 text-muted">“{e.detail}”</p>}
                    <p className="text-xs text-muted">{formatDateTime(e.at)}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {can(user.role, "queries.delete") && detail.invoices.length === 0 && (
            <form action={deleteQueryAction.bind(null, id)} className="text-right">
              <ConfirmSubmit variant="ghost" size="sm" className="text-red-700" message={`Remove query ${query.refNo}? It will be hidden from all lists.`}>
                Remove query
              </ConfirmSubmit>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
