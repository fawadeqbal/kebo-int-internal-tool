"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { RequestState } from "@kebo/shared";
import { Button, buttonClass, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { Modal } from "@/components/common/dialog";
import { date, dueText, money } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { OrderMoney, SentWith } from "@/lib/types-money";
import { requestHref, requestPdfHref, requestPrintHref, requestWords } from "@/lib/requests";
import { recordPaymentHref } from "./pay-links";

/**
 * Payment requests (claude/core-plan.md, phase 1): a row of the order's plan is a payment request, with the
 * same columns as before and where it stands. The status is worked out (never typed): not sent, sent (the
 * request, the proforma for the deposit, the papers at the bank), part paid, paid, cancelled.
 */

type Send = (ref: string, prev: ActionState, form: FormData) => Promise<ActionState>;

const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const grouped = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATE_CLASS: Record<RequestState | "cancelled", string> = {
  paid: "text-ok",
  part_paid: "text-text",
  sent: "text-text",
  not_sent: "text-muted",
  cancelled: "text-muted line-through",
};

/** The status in plain words, with what needs attention under it (late, changed since it was sent). */
export function RequestStatus({
  r,
  late = 0,
  className,
}: {
  r: {
    state: RequestState | "cancelled";
    with: SentWith | null;
    sentOn: string | null;
    revision: number | null;
    changed?: boolean;
    through?: "customer" | "bank";
  };
  late?: number;
  className?: string;
}) {
  return (
    <span className={cn("block text-sm", className)}>
      <span className={cn("font-medium", STATE_CLASS[r.state])}>{requestWords(r)}</span>
      {r.changed && <span className="block text-xs font-medium text-warn">Changed since it was sent</span>}
      {late > 0 && r.state !== "paid" && r.state !== "cancelled" && (
        <span className="block text-xs font-medium text-bad">
          {late} day{late === 1 ? "" : "s"} late
        </span>
      )}
    </span>
  );
}

interface SendWhat {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  orderId: string;
  refId: string;
  number: string;
  label: string;
  amount: string;
  currency: string;
  dueOn: string | null;
  /** Sent before: this sends the next revision. */
  again?: boolean;
}

/**
 * The Send request dialog: says what is kept, then keeps it. Afterwards (`after` "links"): the two ways to
 * give it to the customer. Sent again: the form asks why (R2); the first copy stays as it was.
 */
export function SendDialog({ what, after = "links", onClose }: { what: SendWhat; after?: "links" | "close"; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  const done = useCallback(() => (after === "close" ? onClose() : setSent(true)), [after, onClose]);
  const { orderId, refId, number, again } = what;
  return (
    <Modal
      title={sent ? `${number} is kept as sent` : again ? `Send ${number} again` : `Send ${number}`}
      sub={`${what.label} · ${money(what.amount, what.currency)}${what.dueOn ? ` · due ${date(what.dueOn)}` : ""}`}
      onClose={onClose}
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-2">Now give it to the customer. This copy stays the same whatever changes on the order later.</p>
          <div className="flex flex-wrap gap-2">
            <a href={requestPrintHref(orderId, refId)} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
              View / Print
            </a>
            <a href={requestPdfHref(orderId, refId)} className={buttonClass("secondary", "sm")}>
              Download PDF
            </a>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <ActionForm action={what.action} onDone={done} showSuccess={false} className="flex flex-col gap-4">
          <p className="text-sm text-text-2">
            The request is kept exactly as it prints now: the amount, the due date, what was received so far and our bank details.{" "}
            {again
              ? "The copy sent before stays as it was; this one is the next revision."
              : "If the order changes later, this copy does not."}
          </p>
          <a
            href={requestPrintHref(orderId, refId, { now: true })}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-sm font-medium text-primary hover:underline"
          >
            See how it prints
          </a>
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" pendingText="Keeping…">
              {again ? "Keep and send again" : "Keep and mark as sent"}
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      )}
    </Modal>
  );
}

/** The Send request button with its dialog (a request's own page: the page shows the copy once it is sent). */
export function SendRequest({ primary = false, size = "sm", ...what }: SendWhat & { primary?: boolean; size?: "xs" | "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button size={size} variant={primary ? "primary" : "secondary"} onClick={() => setOpen(true)}>
        {what.again ? "Send again" : "Send request"}
      </Button>
      {open && <SendDialog what={what} after="close" onClose={close} />}
    </>
  );
}

/**
 * The plan as payment requests: the same columns (part, how, due, amount, received) with the request's
 * number, where it stands and the one thing to do next on each row.
 */
export function PlanRequests({
  orderId,
  plan,
  currency,
  total,
  received,
  due,
  send,
  canPay,
  back,
}: {
  orderId: string;
  plan: OrderMoney["plan"];
  currency: string;
  total: string;
  received: string;
  due: string;
  send: Send;
  canPay: boolean;
  /** Where Record payment comes back to. */
  back: string;
}) {
  // The dialog lives here, not in the row: once sent, the row's button changes and the dialog still says what to do next.
  const [sending, setSending] = useState<SendWhat | null>(null);
  const close = useCallback(() => setSending(null), []);
  if (!plan.items.length && !plan.cancelled.length) return <p className="text-sm text-muted">No plan yet.</p>;
  const quiet = "text-sm font-medium whitespace-nowrap text-primary hover:underline";
  /** The one thing to do next on a row. */
  const next = (i: OrderMoney["plan"]["items"][number]) => {
    const r = i.request;
    const open = r.state !== "paid";
    return open && r.through === "bank" && r.state === "not_sent" ? (
      <Link href={`/orders/${orderId}/documents`} className={quiet}>
        Bank papers
      </Link>
    ) : open && plan.canSend && (r.state === "not_sent" || r.changed) ? (
      <Button
        size="xs"
        variant="secondary"
        onClick={() =>
          setSending({
            action: send.bind(null, i.id),
            orderId,
            refId: i.id,
            number: i.number,
            label: i.label,
            amount: i.amount,
            currency,
            dueOn: i.dueOn,
            again: r.with === "request",
          })
        }
      >
        {r.with === "request" ? "Send again" : "Send request"}
      </Button>
    ) : open && canPay ? (
      <Link href={recordPaymentHref({ kind: "in", order: orderId, amount: i.open, back })} className={quiet}>
        Record payment
      </Link>
    ) : (
      <Link href={requestHref(orderId, i.id)} className={quiet}>
        View
      </Link>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {/* Phones: one block per request, so the status and what to do next are never off the screen. */}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line sm:hidden" aria-label="Payment requests">
        {plan.items.map((i) => (
          <li key={i.id} className="flex flex-col gap-1.5 px-3 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <Link href={requestHref(orderId, i.id)} className="font-medium hover:text-primary">
                {i.number}
              </Link>
              <span className="font-semibold tabular">{grouped(i.amount)}</span>
            </span>
            <span className="text-sm text-text-2">
              {i.label} · {dueText(i)}
              {Number(i.paid) > 0 && i.request.state !== "paid" ? ` · ${grouped(i.paid)} received` : ""}
            </span>
            <span className="flex items-center justify-between gap-3">
              <RequestStatus r={i.request} late={i.late} />
              {next(i)}
            </span>
          </li>
        ))}
        {plan.cancelled.map((c) => (
          <li key={c.paperId} className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-muted">
            <span>
              {c.number} · {c.label ?? "Payment request"}
            </span>
            <Link href={requestHref(orderId, c.ref)} className={quiet}>
              Cancelled
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-line sm:block">
        <Table>
          <THead>
            <tr>
              <Th>Request</Th>
              <Th>Part</Th>
              <Th>Due</Th>
              <Th className="text-right">Amount {currency}</Th>
              <Th className="hidden text-right sm:table-cell">Received</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Next</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {plan.items.map((i) => {
              const r = i.request;
              return (
                <Tr key={i.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={requestHref(orderId, i.id)} className="font-medium hover:text-primary">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>
                    {i.label}
                    <span className="block text-xs text-muted">{i.how}</span>
                  </Td>
                  <Td className="text-sm">{dueText(i)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{grouped(i.amount)}</Td>
                  <Td className="hidden text-right whitespace-nowrap tabular sm:table-cell">{grouped(i.paid)}</Td>
                  <Td>
                    <RequestStatus r={r} late={i.late} />
                  </Td>
                  <Td className="text-right">{next(i)}</Td>
                </Tr>
              );
            })}
            {plan.cancelled.map((c) => (
              <Tr key={c.paperId}>
                <Td className="whitespace-nowrap">
                  <Link href={requestHref(orderId, c.ref)} className="font-medium text-muted hover:text-primary">
                    {c.number}
                  </Link>
                </Td>
                <Td className="text-muted">{c.label ?? "Payment request"}</Td>
                <Td className="text-sm text-muted">Sent {dayMonth(c.sentOn)}</Td>
                <Td className="text-right whitespace-nowrap text-muted tabular">{c.amount ? grouped(c.amount) : ""}</Td>
                <Td className="hidden sm:table-cell" />
                <Td>
                  <RequestStatus r={{ state: "cancelled", with: "request", sentOn: c.sentOn, revision: c.revision }} />
                </Td>
                <Td className="text-right">
                  <Link href={requestHref(orderId, c.ref)} className={quiet}>
                    View
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      {sending && <SendDialog key={sending.refId} what={sending} onClose={close} />}
      <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
        <span className="text-muted">
          Order total <span className="font-semibold text-text tabular">{money(total, currency)}</span>
        </span>
        <span className="text-muted">
          Received <span className="font-semibold text-text tabular">{money(received, currency)}</span>
        </span>
        <span className="text-muted">
          Still due <span className="font-semibold text-text tabular">{money(due, currency)}</span>
        </span>
      </div>
    </div>
  );
}
