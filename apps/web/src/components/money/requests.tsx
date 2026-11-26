"use client";

import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import type { ActionState } from "@/lib/actions";
import { requestPdfHref, requestPrintHref } from "@/lib/requests";
import { EmailPanel } from "@/components/send/send";
import { useFileTools } from "@/components/files/file-tools";
import { emailRequestAction } from "@/app/(app)/send-actions";

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
 * Send request: the app's one Email window (design "Email and Share", 26 Nov 2026). From the app, the request is
 * kept exactly as it prints now and emailed with its PDF; sent by the person (their mail app, WhatsApp, in
 * person), it is kept as sent. Sent again, the form asks why (R2); the first copy stays as it was.
 */
export function SendDialog({ what, onClose }: { what: SendWhat; onClose: () => void }) {
  const { date } = useTime();
  const tools = useFileTools();
  const { orderId, refId, number, again } = what;
  const key = `payment-request:${refId}`;
  const name = `Payment request ${number}.pdf`;
  const sum = money(what.amount, what.currency);
  const to = tools?.share.to ?? null;
  // Before it is kept, the request as it prints now; the email takes the kept copy (kept first).
  const items = [{ key, name, detail: `${what.label} · ${sum}`, view: requestPrintHref(orderId, refId, { now: true }), download: requestPdfHref(orderId, refId, undefined, true), paper: key }];
  const going = [{ key, name, download: requestPdfHref(orderId, refId), paper: key }];
  const refNo = tools?.share.refNo ?? "";
  return (
    <EmailPanel
      title={again ? `Send ${number} again` : `Send ${number}`}
      description={`${what.label} · ${sum}${what.dueOn ? ` · due ${date(what.dueOn)}` : ""}`}
      onClose={onClose}
      items={items}
      to={to}
      subject={`Payment request ${number}${refNo ? ` · order ${refNo}` : ""}`}
      message={`Dear ${to?.name?.split(" ")[0] ?? "Sir or Madam"}, please find our payment request ${number} for ${what.label.toLowerCase()}: ${sum}${what.dueOn ? `, due ${date(what.dueOn)}` : ""}.`}
      emailAction={emailRequestAction.bind(null, orderId, refId, going)}
      markAction={what.action}
      howAsReason={false}
      markWord={() => (again ? "Keep and send again" : "Keep it as sent")}
      happens={{
        app: () => [
          "The request is kept exactly as it prints now: the amount, the due date, what was received so far and our bank details.",
          "Then one email goes out from the company's address with its PDF.",
          again ? "The copy sent before stays as it was; this one is the next revision." : "If the order changes later, this copy does not.",
        ],
        mark: (how) => ["Nothing is sent by the app.", `The request is kept exactly as it prints now, as sent ${how}.`],
      }}
      today={tools?.share.today ?? new Date().toISOString().slice(0, 10)}
    />
  );
}
