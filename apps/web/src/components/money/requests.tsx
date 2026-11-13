"use client";

import { useCallback, useState } from "react";
import type { RequestState } from "@kebo/shared";
import { Button, buttonClass, cn } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { Modal } from "@/components/common/dialog";
import { date, money } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { SentWith } from "@/lib/types-money";
import { requestPdfHref, requestPrintHref, requestWords } from "@/lib/requests";

/**
 * Payment requests (claude/core-plan.md, phase 1): a row of the order's plan is a payment request, with the
 * same columns as before and where it stands. The status is worked out (never typed): not sent, sent (the
 * request, the proforma for the deposit, the papers at the bank), part paid, paid, cancelled.
 */

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
