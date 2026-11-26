"use client";

import { EmailWindow, type Outgoing } from "@/components/send/send";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** One of the deal's drafts ready to go (priced), as the send window lists it under Include. */
export type SendItem = { id: string; refNo: string; letter: string; number: number; total: string; printHref: string; pdfHref: string };

const nameOf = (x: SendItem) => `${x.refNo} R${x.number}`;

/**
 * "QUO-2026-0531-C, D and E" (with `revisions`: "QUO-2026-0531-C R1, D R1 and E R1"): the first in full, the
 * others by their letter when they share its number.
 */
export function namesOf(items: SendItem[], revisions = false) {
  const first = items[0];
  if (!first) return "";
  const base = first.refNo.endsWith(`-${first.letter}`) ? first.refNo.slice(0, -first.letter.length - 1) : first.refNo;
  const same = items.every((x) => x.refNo === base || x.refNo === `${base}-${x.letter}`);
  const parts = items.map((x, i) => `${i === 0 || !same ? x.refNo : x.letter}${revisions ? ` R${x.number}` : ""}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
}

/**
 * "Send R1 to <customer>": the app's one Email window (design "Email and Share", 26 Nov 2026) for a quotation.
 * From the app (to, copy, subject, message, the PDF attached), or I'll send it myself (my mail app, or I sent it
 * already: how and when; nothing leaves the system). A revision already sent has only the email ("Send again").
 * When the deal has other drafts ready, Include lists them, ticked (design "one way, any number"): they go in the
 * same email, each with its PDF, or are marked sent with it; the subject follows what is included.
 */
export function SendWindow({
  number,
  customer,
  emailAction,
  markAction,
  to,
  cc,
  subject,
  message,
  fileName,
  printHref,
  pdfHref,
  today,
  revisionId,
  together = [],
  subjectMany = "",
  messageMany = "",
  checks = [],
}: {
  number: number;
  customer: string;
  /** Sends this one, or (with others included) all of them in one email. */
  emailAction: Action;
  /** Marks it sent (or all included) without sending anything (null: it is sent already). */
  markAction: Action | null;
  to: string;
  cc: string;
  subject: string;
  message: string;
  fileName: string;
  printHref: string;
  pdfHref: string;
  today: string;
  /** This revision (one of `together`). */
  revisionId?: string;
  /** The deal's drafts ready to go, this one among them, in letter order (fewer than two: no Include). */
  together?: SendItem[];
  /** The subject when several go: "{names}" is where their numbers go. */
  subjectMany?: string;
  messageMany?: string;
  /** What to look at before it goes (items without a price…): said at the top (review 24 Nov: none was). */
  checks?: string[];
}) {
  const again = !markAction;
  const several = !again && together.length > 1 && together.some((x) => x.id === revisionId);
  // This one first (it always goes), then the deal's other ready drafts in letter order.
  const list = several ? [together.find((x) => x.id === revisionId)!, ...together.filter((x) => x.id !== revisionId)] : [];
  const items: Outgoing[] = several
    ? list.map((x) => ({ key: x.id, name: `${nameOf(x)}.pdf`, view: x.printHref, download: x.pdfHref, aside: x.total }))
    : [{ key: revisionId ?? "this", name: fileName, view: printHref, download: pdfHref }];
  const sendItems = (chosen: Outgoing[]) => list.filter((x) => chosen.some((c) => c.key === x.id));
  const after = [`The inquiry becomes Quoted; next, record ${customer}’s answer.`];
  return (
    <EmailWindow
      items={items}
      ticked
      to={{ name: customer, email: to, cc }}
      subject={(chosen) => (chosen.length > 1 ? subjectMany.replace("{names}", namesOf(sendItems(chosen))) : subject)}
      message={(chosen) => (chosen.length > 1 ? messageMany : message)}
      emailAction={emailAction}
      markAction={markAction}
      againOnly={again}
      checks={checks}
      today={today}
      markWord={(n) => (n > 1 ? `Mark ${n} as sent` : `Mark R${number} as sent`)}
      happens={{
        app: (chosen) =>
          again
            ? ["The email goes out with the same PDF.", `R${number} does not change: it stays as it was sent.`]
            : chosen.length > 1
              ? [
                  `One email goes out with the ${chosen.length} PDFs.`,
                  `${namesOf(sendItems(chosen), true)} become Sent: by email, today. Each is then kept exactly as sent.`,
                  ...after,
                ]
              : ["The email goes out with the PDF.", `R${number} becomes Sent: by email, today. It is then kept exactly as sent.`, ...after],
        mark: (how, chosen) => [
          "Nothing is sent by the system.",
          chosen.length > 1
            ? `${namesOf(sendItems(chosen), true)} become Sent: ${how}. Each is then kept exactly as sent.`
            : `R${number} becomes Sent: ${how}. It is then kept exactly as sent.`,
          ...after,
        ],
      }}
    />
  );
}
