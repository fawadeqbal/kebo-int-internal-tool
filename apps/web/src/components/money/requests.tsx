"use client";

import { useCallback, useState } from "react";
import { Button, buttonClass, linkClass } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { Modal } from "@/components/common/dialog";
import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import type { ActionState } from "@/lib/actions";
import { requestPdfHref, requestPrintHref } from "@/lib/requests";

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
 * The Send request dialog: the PDF to give the customer first, then it is kept as sent (e2e 24 Nov: it was marked
 * sent before "Now give it to the customer"). Afterwards (`after` "links"): the kept copy's two links again.
 * Sent again: the form asks why (R2); the first copy stays as it was.
 */
export function SendDialog({ what, after = "links", onClose }: { what: SendWhat; after?: "links" | "close"; onClose: () => void }) {
  const { date } = useTime();
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
          <p className="text-sm text-text-2">This copy stays the same whatever changes on the order later. Its PDF, again:</p>
          <div className="flex flex-wrap gap-2">
            <a href={requestPrintHref(orderId, refId)} className={buttonClass("primary", "sm")}>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">1. Give it to the customer</span>
            <a href={requestPrintHref(orderId, refId, { now: true })} className={linkClass}>
              View / Print
            </a>
            <a href={requestPdfHref(orderId, refId, undefined, true)} className={linkClass}>
              Download PDF
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">2.</span>
            <SubmitButton size="sm" pendingText="Keeping…">
              {again ? "Keep and send again" : "Given: keep it as sent"}
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

