import Link from "next/link";
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, type ExpenseCategory, type PaymentMethod } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, dateTime, money } from "@/lib/format";
import type { Submission, SubmissionList } from "@/lib/types-approvals";
import { ApproveButtons, WithdrawButton } from "@/components/money/approval-actions";
import { approveAction, sendBackAction, withdrawAction } from "@/app/(app)/approvals/actions";

const amountOf = (s: Submission) => (s.amount && s.currency ? money(s.amount, s.currency) : "—");
const whatOf = (s: Submission) =>
  s.kind === "payment"
    ? `Payment received${s.method ? ` · ${PAYMENT_METHOD_LABEL[s.method as PaymentMethod] ?? s.method}` : ""}`
    : `${s.description ?? "Cost"}${s.category ? ` · ${EXPENSE_CATEGORY_LABEL[s.category as ExpenseCategory] ?? s.category}` : ""}`;

/**
 * Money someone added that a manager has not verified yet (and what a manager sent back): it does not count
 * until it is verified. A manager verifies or sends back right here; the person who added it can take it
 * back. `orderId`: only this order's (its Payment tab); without it, everything this person sent or may verify.
 * Nothing waiting: nothing is drawn.
 */
export async function WaitingToVerify({
  orderId,
  verifies,
  title = "Waiting to be verified",
  limit,
}: {
  orderId?: string;
  /** This person verifies (records money themselves); otherwise they see what they sent. */
  verifies: boolean;
  title?: string;
  /** Show this many (Home); the rest are behind one link to the whole list. */
  limit?: number;
}) {
  const list = await api.get<SubmissionList>("/submissions", { status: "all", orderId, mine: verifies ? undefined : "true", pageSize: 100 }).catch(() => null);
  const rows = (list?.rows ?? []).filter((s) => s.status === "pending" || s.status === "sent_back");
  if (rows.length === 0) return null;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <section aria-label={title} className="rounded-xl border border-warn/40 bg-warn-soft/40">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-[18px] pt-3.5">
        <h2 className="text-sm font-bold">
          {title} <span className="font-normal text-text-2">· {rows.length}</span>
        </h2>
        <p className="text-xs text-text-2">{verifies ? "It counts on the order once you verify it." : "It counts once a manager verifies it."}</p>
      </header>
      <ul className="mt-2 divide-y divide-line/70">
        {shown.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[18px] py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {amountOf(s)} <span className="font-normal text-text-2">· {whatOf(s)}</span>
                {!orderId && s.order && (
                  <>
                    {" · "}
                    <Link href={`/orders/${s.order.id}/payment`} className="font-medium text-primary hover:underline">
                      {s.order.refNo}
                    </Link>
                  </>
                )}
              </p>
              <p className="text-xs text-text-2">
                {s.paidOn || s.spentOn ? `${date(s.paidOn ?? s.spentOn)} · ` : ""}
                sent by {s.submittedBy.name} · {dateTime(s.submittedAt)}
                {s.reference ? ` · ${s.reference}` : ""}
                {s.file && (
                  <>
                    {" · "}
                    <a href={`/files/${s.file.id}`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                      Open the slip
                    </a>
                  </>
                )}
              </p>
              {s.status === "sent_back" && (
                <p className="mt-1 text-xs text-bad">
                  <Badge tone="bad">Sent back</Badge> {s.reason ?? ""}
                  {s.decidedBy ? ` · ${s.decidedBy.name}` : ""}
                </p>
              )}
            </div>
            {s.can.approve ? (
              <ApproveButtons approve={approveAction.bind(null, s.id)} sendBack={sendBackAction.bind(null, s.id)} what={`${whatOf(s).toLowerCase()} · ${amountOf(s)}`} verb="Verify" />
            ) : s.can.withdraw ? (
              <WithdrawButton action={withdrawAction.bind(null, s.id)} />
            ) : (
              <Badge tone="warn">Waiting</Badge>
            )}
          </li>
        ))}
      </ul>
      {shown.length < rows.length && (
        <p className="border-t border-line/70 px-[18px] py-2.5 text-sm">
          <Link href="/approvals" className="font-medium text-primary hover:underline">
            {rows.length - shown.length} more →
          </Link>
        </p>
      )}
    </section>
  );
}
