import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { can, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LinkTabs,
  ListToolbar,
  PageHeader,
  Pager,
  StatusBadge,
  toPage,
  type StatusMeaning,
} from "@kebo/ui";
import { api } from "@/lib/api";
import { hasFeature, requireUser } from "@/lib/session";
import { date, dateTime, money, timeAgo } from "@/lib/format";
import type { Submission, SubmissionList, SubmissionStatus } from "@/lib/types-approvals";
import { ApproveButtons, WithdrawButton } from "@/components/money/approval-actions";
import { approveAction, sendBackAction, withdrawAction } from "./actions";
import { crumbsFor } from "@/lib/nav";

export const metadata = { title: "Approvals" };

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
  searchParams: Promise<{ status?: string; mine?: string; page?: string }>;
}) {
  const me = await requireUser();
  const approver = can(me, "payments.record") || (can(me, "expenses.manage") && (await hasFeature("expenses")));
  const submitter = can(me, "money.submit");
  if (!approver && !submitter) redirect("/forbidden");
  const sp = await searchParams;
  const mine = !approver || sp.mine === "true";
  const status: SubmissionStatus = STATUSES.includes(sp.status as SubmissionStatus) ? (sp.status as SubmissionStatus) : "pending";
  const page = toPage(sp.page);
  const list = await api.get<SubmissionList>("/submissions", { status, mine: mine ? "true" : undefined, page, pageSize: PAGE_SIZE });
  const base = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    return `/approvals${q.size ? `?${q}` : ""}`;
  };
  const keep = { mine: mine && approver ? "true" : undefined, status: status === "pending" ? undefined : status };

  return (
    <div className="max-w-4xl">
      <PageHeader
        crumbs={crumbsFor("/approvals")}
        title="Approvals"
        summary={
          mine
            ? "Sent for approval: money received and expenses you added. Each counts once a manager approves it."
            : list.counts.pending
              ? `To approve: ${list.counts.pending} waiting · approving records it as the usual payment or expense, with its photo`
              : "Nothing is waiting for you"
        }
      />
      {approver && submitter && (
        <LinkTabs
          label="Whose"
          className="mb-4"
          tabs={[
            { href: "/approvals", label: "To approve", active: !mine },
            { href: "/approvals?mine=true", label: "Mine", active: mine },
          ]}
        />
      )}
      <ListToolbar
        label="Which ones"
        chips={STATUSES.map((s) => ({
          key: s,
          label: mine || s !== "pending" ? STATUS_LABEL[s] : "To approve",
          count: list.counts[s],
          href: base({ mine: keep.mine, status: s === "pending" ? undefined : s }),
          active: status === s,
        }))}
      />
      {!mine && status === "pending" && list.counts.pending > 0 && (
        <Alert tone="info" className="mb-3">
          They added it; you approve it. Nothing counts until you do.
        </Alert>
      )}
      <Card className="overflow-clip p-0">
        {list.rows.length === 0 ? (
          <EmptyState
            framed
            title={
              status === "pending" ? (mine ? "Nothing waiting" : "Nothing to approve") : `Nothing ${STATUS_LABEL[status].toLowerCase()}`
            }
            description={
              mine
                ? "Add money a customer sent, or an expense, on the phone app and tap “Send for approval”."
                : "When someone adds money received or an expense for approval, it shows here and you are told."
            }
          />
        ) : (
          <ul aria-label={mine ? "Sent for approval" : "To approve"} className="divide-y divide-line">
            {list.rows.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </ul>
        )}
        <Pager base="/approvals" params={keep} page={page} pageSize={PAGE_SIZE} total={list.total} />
      </Card>
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
            <Link href={`/orders/${s.order.id}`} className="font-medium text-primary hover:underline">
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

/** The bank slip or receipt: a thumbnail that opens it, a link for a PDF, or "No photo". */
function Photo({ s }: { s: Submission }) {
  if (!s.file)
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-center text-xs text-text-2">
        No photo
      </span>
    );
  const href = `/files/submissions/${s.id}?view=1`;
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
