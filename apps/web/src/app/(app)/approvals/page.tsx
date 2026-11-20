import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Clock, FileText } from "lucide-react";
import { can, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";
import { Badge, Card, EmptyState, LinkTabs, PageHeader, Pager, Segmented, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, toPage, Tr, type StatusMeaning, Notice, linkClass, cn } from "@kebo/ui";
import { FilterCard } from "@/components/common/filter-card";
import { api } from "@/lib/api";
import { hasFeature, requireUser } from "@/lib/session";
import { date, dateTime, money, timeAgo, whole } from "@/lib/format";
import type { Submission, SubmissionList, SubmissionStatus } from "@/lib/types-approvals";
import { ApproveButtons, VerifyChosen, WithdrawButton } from "@/components/money/approval-actions";
import { approveAction, approveManyAction, sendBackAction, withdrawAction } from "./actions";
import { today } from "@/components/orders/today";

export const metadata = { title: "To verify" };

const PAGE_SIZE = 25;
const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  sent_back: "Sent back",
  withdrawn: "Withdrawn",
};
const STATUS_MEANING: Record<SubmissionStatus, StatusMeaning> = { pending: "warn", approved: "ok", sent_back: "bad", withdrawn: "neutral" };
const STATUSES: SubmissionStatus[] = ["pending", "sent_back", "approved", "withdrawn"];
/** Photos a browser shows as a thumbnail (HEIC and PDFs get a link only). */
const PICTURES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const kindWords = (s: Submission) => (s.kind === "payment" ? "Money received" : "Expense");
/** What it is about: the customer and order for money received; what was spent for an expense. */
const whatOf = (s: Submission) =>
  s.kind === "payment"
    ? (s.order?.customer ?? s.customer?.name ?? "Customer")
    : `${s.description ?? "Expense"}${s.category ? ` · ${EXPENSE_CATEGORY_LABEL[s.category as ExpenseCategory] ?? s.category}` : ""}`;
const amountOf = (s: Submission) => (s.amount && s.currency ? money(s.amount, s.currency) : "—");
/** For screen readers on the row's buttons. */
const nameOf = (s: Submission) => [kindWords(s).toLowerCase(), s.order?.refNo, amountOf(s)].filter(Boolean).join(" · ");

/**
 * Money received and expenses staff add for a manager to approve. Approvers (those who record payments
 * or expenses) see what waits for them, with Send back… and Approve; everyone who adds them sees their
 * own (Mine). Staff add them on the phone; it counts once approved.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string; page?: string; q?: string }>;
}) {
  const me = await requireUser();
  const approver = can(me, "payments.record") || (can(me, "expenses.manage") && (await hasFeature("expenses")));
  const submitter = can(me, "money.submit");
  if (!approver && !submitter) redirect("/forbidden");
  const sp = await searchParams;
  const mine = !approver || sp.mine === "true";
  const status: SubmissionStatus = STATUSES.includes(sp.status as SubmissionStatus) ? (sp.status as SubmissionStatus) : "pending";
  const page = toPage(sp.page);
  const text = sp.q?.trim() || undefined;
  const [list, everything] = await Promise.all([
    api.get<SubmissionList>("/submissions", { status, mine: mine ? "true" : undefined, q: text, page, pageSize: PAGE_SIZE }),
    // The figures over the list are for everything waiting, whatever is searched.
    text ? api.get<SubmissionList>("/submissions", { status, mine: mine ? "true" : undefined, page: 1, pageSize: 1 }) : null,
  ]);
  const all = everything ?? list;
  const base = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    return `/approvals${q.size ? `?${q}` : ""}`;
  };
  const keep = { mine: mine && approver ? "true" : undefined, status: status === "pending" ? undefined : status, q: sp.q };
  // The waiting ones on this page: their total per currency, and how long the oldest has waited.
  const sums = new Map<string, number>();
  for (const r of list.rows) if (r.status === "pending" && r.amount && r.currency) sums.set(r.currency, (sums.get(r.currency) ?? 0) + Number(r.amount));
  const waitingSum = [...sums.entries()].map(([c, a]) => whole(a, c)).join(" · ");
  const now = Date.parse(today());
  const firstWait = list.rows.filter((r) => r.status === "pending").map((r) => Date.parse(r.submittedAt.slice(0, 10))).sort((a, b) => a - b)[0];
  const oldest = firstWait === undefined ? null : Math.max(0, Math.round((now - firstWait) / 86_400_000));

  return (
    <div>
      <PageHeader
        kind="list"
        crumbs={[{ label: "Money" }, { label: "Payments", href: "/payments" }, { label: "To verify" }]}
        title="To verify"
        primary={!mine && status === "pending" && list.rows.some((r) => r.can.approve) ? <VerifyChosen action={approveManyAction} /> : undefined}
        views={
          approver && submitter ? (
            <Segmented
              label="Whose"
              options={[
                { href: base({ q: sp.q }), label: "To approve", active: !mine },
                { href: base({ mine: "true", q: sp.q }), label: "Mine", active: mine },
              ]}
            />
          ) : undefined
        }
      />
      {!mine && (
        <StatRow facts>
          <StatTile
            icon={Clock}
            iconColor={2}
            label="Waiting"
            value={all.counts.pending}
            sub={status === "pending" && waitingSum && !text ? waitingSum : undefined}
            tone={all.counts.pending ? "warn" : undefined}
          />
          <StatTile label="Oldest" value={oldest === null ? "—" : oldest === 0 ? "today" : `${oldest} day${oldest === 1 ? "" : "s"}`} />
          <StatTile icon={Check} iconColor={1} label="Approved" value={all.counts.approved} sub={all.counts.sent_back ? `${all.counts.sent_back} sent back` : undefined} />
        </StatRow>
      )}
      <LinkTabs
        label="Which ones"
        className="mb-4"
        tabs={STATUSES.map((s) => ({
          label: mine || s !== "pending" ? STATUS_LABEL[s] : "To approve",
          count: list.counts[s],
          href: base({ mine: keep.mine, status: s === "pending" ? undefined : s, q: sp.q }),
          active: status === s,
        }))}
      />
      <FilterCard search="Search order, customer, who sent it…" value={sp.q} keep={{ mine: keep.mine, status: keep.status }} clearHref={base({ mine: keep.mine, status: keep.status })} />
      {!mine && status === "pending" && list.counts.pending > 0 && (
        <Notice tone="info" className="mb-3">
          They added it; you approve it. Nothing counts until you do.
        </Notice>
      )}
      <Card className="overflow-clip p-0">
        {list.rows.length === 0 ? (
          <EmptyState
            framed
            title={
              text ? "Nothing matches" : status === "pending" ? (mine ? "Nothing waiting" : "Nothing to approve") : `Nothing ${STATUS_LABEL[status].toLowerCase()}`
            }
            description={
              text
                ? "Try other words, or clear the search."
                : mine
                ? "Add money a customer sent, or an expense, on the phone app and tap “Send for approval”."
                : "When someone adds money received or an expense for approval, it shows here and you are told."
            }
          />
        ) : (
          <>
            <ul aria-label={mine ? "Sent for approval" : "To approve"} className="divide-y divide-line md:hidden">
              {list.rows.map((s) => (
                <Row key={s.id} s={s} />
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    {!mine && status === "pending" && (
                      <Th className="w-10">
                        <span className="sr-only">Choose</span>
                      </Th>
                    )}
                    <Th>What</Th>
                    <Th>Date</Th>
                    <Th>{status === "pending" && !mine ? "Customer · for" : "Who · for"}</Th>
                    <Th>Method</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>By</Th>
                    <Th>Slip</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {list.rows.map((s) => (
                    <TableRow key={s.id} s={s} choose={!mine && status === "pending"} />
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Card>
      <Pager base="/approvals" params={keep} page={page} pageSize={PAGE_SIZE} total={list.total} bare />
    </div>
  );
}

function Row({ s }: { s: Submission }) {
  const when = s.paidOn ?? s.spentOn;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
      <Photo s={s} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.kind === "payment" ? "info" : "neutral"}>{kindWords(s)}</Badge>
          <StatusBadge meaning={STATUS_MEANING[s.status]}>{STATUS_LABEL[s.status]}</StatusBadge>
        </div>
        <p className="mt-1 text-sm font-semibold text-text">
          {whatOf(s)} <span className="tabular whitespace-nowrap">· {amountOf(s)}</span>
        </p>
        <p className="mt-0.5 text-sm text-text-2">
          {s.order ? (
            <Link href={`/orders/${s.order.id}`} className={linkClass}>
              {s.order.refNo}
            </Link>
          ) : (
            "No order"
          )}
          {when && (
            <>
              {" "}
              · {s.kind === "payment" ? "paid" : "spent"} {date(when)}
            </>
          )}
          {s.reference && <> · ref. {s.reference}</>}
        </p>
        <p className="mt-0.5 text-xs text-text-2">
          Added by {s.submittedBy.name},{" "}
          <time dateTime={s.submittedAt} title={dateTime(s.submittedAt)}>
            {timeAgo(s.submittedAt)}
          </time>
          {s.decidedBy && s.status !== "pending" && s.status !== "withdrawn" && (
            <>
              {" "}
              · {s.status === "approved" ? "approved" : "sent back"} by {s.decidedBy.name}
            </>
          )}
        </p>
        {s.status === "sent_back" && s.reason && (
          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text">
            <span className="font-medium">Why it was sent back:</span> {s.reason}
          </p>
        )}
      </div>
      {(s.can.approve || s.can.withdraw) && (
        <div className="shrink-0 sm:pt-0.5">
          {s.can.approve ? (
            <ApproveButtons approve={approveAction.bind(null, s.id)} sendBack={sendBackAction.bind(null, s.id)} what={nameOf(s)} />
          ) : (
            <WithdrawButton action={withdrawAction.bind(null, s.id)} />
          )}
        </div>
      )}
    </li>
  );
}

/** One submission as a table row (board VerificationQueue): what, date, who it is from and for, amount, who added it, the slip, and the buttons. */
function TableRow({ s, choose }: { s: Submission; choose?: boolean }) {
  const when = s.paidOn ?? s.spentOn;
  return (
    <Tr className="align-middle">
      {choose && (
        <Td>
          {s.can.approve && (
            <input type="checkbox" name="id" value={s.id} form="verify-chosen" aria-label={`Choose ${nameOf(s)}`} className="size-4 accent-[var(--primary-solid)]" />
          )}
        </Td>
      )}
      <Td>
        <div className="flex flex-col items-start gap-1">
          <Badge tone={s.kind === "payment" ? "info" : "neutral"}>{kindWords(s)}</Badge>
          {s.status !== "pending" && <StatusBadge meaning={STATUS_MEANING[s.status]}>{STATUS_LABEL[s.status]}</StatusBadge>}
        </div>
      </Td>
      <Td className="whitespace-nowrap">{when ? date(when) : "—"}</Td>
      <Td className="min-w-56">
        <span className="block font-semibold">{whatOf(s)}</span>
        <span className="block text-xs text-text-2">
          {s.order ? (
            <Link href={`/orders/${s.order.id}`} className="hover:text-primary">
              {s.order.refNo}
            </Link>
          ) : (
            "No order"
          )}
          {s.reference && <> · ref. {s.reference}</>}
        </span>
        {s.status === "sent_back" && s.reason && <span className="mt-1 block text-xs text-bad">Sent back: {s.reason}</span>}
      </Td>
      <Td className="text-sm">{s.method ?? "—"}</Td>
      <Td className="text-right whitespace-nowrap tabular">{amountOf(s)}</Td>
      <Td className="text-sm">
        <span title={dateTime(s.submittedAt)}>{s.submittedBy.name.split(" ")[0]}</span>
      </Td>
      <Td className="text-sm">
        {s.file ? (
          <a href={`/files/${s.file.id}?view=1`} target="_blank" rel="noopener" className={cn(linkClass, "inline-flex items-center gap-1")}>
            <FileText className="size-3.5" aria-hidden /> {s.file.name}
          </a>
        ) : (
          <span className="text-muted">no slip</span>
        )}
      </Td>
      <Td className="text-right">
        {s.can.approve ? (
          <ApproveButtons approve={approveAction.bind(null, s.id)} sendBack={sendBackAction.bind(null, s.id)} what={nameOf(s)} />
        ) : s.can.withdraw ? (
          <WithdrawButton action={withdrawAction.bind(null, s.id)} />
        ) : null}
      </Td>
    </Tr>
  );
}

/** The bank slip or receipt: a thumbnail that opens it, a link for a PDF, or "No photo". */
function Photo({ s }: { s: Submission }) {
  if (!s.file)
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-center text-xs text-text-2">
        No photo
      </span>
    );
  const href = `/files/${s.file.id}?view=1`;
  const label = `Open the ${s.kind === "payment" ? "bank slip" : "receipt"} (${s.file.name}) in a new tab`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={label}
      className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2 text-text-2 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {PICTURES.has(s.file.type) ? (
        // A photo kept by the API, through this site's file route (not optimisable by next/image).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={href} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="flex flex-col items-center gap-0.5 text-xs">
          <FileText className="size-5" aria-hidden />
          {s.file.type === "application/pdf" ? "PDF" : "File"}
        </span>
      )}
    </a>
  );
}
