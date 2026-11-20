"use client";

import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { SENT_VIA, SENT_VIA_LABEL, SENT_VIA_TEXT, type SentVia } from "@kebo/shared";
import { cn, Field, Input, RULES, Select, Textarea, linkClass } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, useClosePanel, WhatHappens, WindowFooter } from "@/components/common/panel";
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
 * "Send R1 to <customer>": one window, two choices. Email it from here (to, copy, subject, message, the PDF
 * attached), or "I sent it myself" (how and when; nothing leaves the system). Each says what happens above
 * its button. A revision already sent has only the email ("Send again"): nothing about it changes.
 * When the deal has other drafts ready, Include lists them, ticked (design "one way, any number"): they go in
 * the same email, each with its PDF, or are marked sent with it; the subject follows what is included.
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
}) {
  const close = useClosePanel();
  const [by, setBy] = useState<"email" | "self">("email");
  const [how, setHow] = useState<SentVia>("whatsapp");
  const again = !markAction;
  // Include: every ready draft, ticked; this one always goes.
  const several = !again && together.length > 1 && together.some((x) => x.id === revisionId);
  const [left, setLeft] = useState<string[]>([]);
  const chosen = several ? together.filter((x) => x.id === revisionId || !left.includes(x.id)) : [];
  const many = chosen.length > 1;
  // The subject and message follow what is included until they are typed in.
  const [subjectTyped, setSubjectTyped] = useState<string | null>(null);
  const [messageTyped, setMessageTyped] = useState<string | null>(null);
  const subjectNow = subjectTyped ?? (many ? subjectMany.replace("{names}", namesOf(chosen)) : subject);
  const messageNow = messageTyped ?? (many ? messageMany : message);
  const include = several ? (
    <fieldset className="flex flex-col">
      <legend className="mb-1.5 text-sm font-medium text-text">Include</legend>
      <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {together.map((x) => {
          const me = x.id === revisionId;
          const on = me || !left.includes(x.id);
          return (
            <label key={x.id} className={cn("flex min-h-11 items-center gap-2.5 px-3.5 py-2 text-sm", !me && "cursor-pointer hover:bg-surface-2/60")}>
              {me && <input type="hidden" name="include" value={x.id} />}
              <input
                type="checkbox"
                name={me ? undefined : "include"}
                value={x.id}
                checked={on}
                disabled={me}
                onChange={(e) => setLeft((l) => (e.target.checked ? l.filter((id) => id !== x.id) : [...l, x.id]))}
                className="size-[18px] shrink-0 accent-primary"
              />
              <span className="font-semibold">{nameOf(x)}</span>
              <span className="ml-auto tabular whitespace-nowrap text-text-2">{x.total}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  ) : null;
  const choice = (value: "email" | "self", title: string, sub: string) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-3 text-sm transition-colors",
        by === value ? "border-primary bg-primary-soft/50 ring-1 ring-primary" : "border-line hover:border-line-strong",
      )}
    >
      <input type="radio" name="send-by" className="mt-1 accent-primary" checked={by === value} onChange={() => setBy(value)} />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-text-2">{sub}</span>
      </span>
    </label>
  );
  const file = (name: string, print: string, download: string) => (
    <div key={name} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-md">
      <span className="font-semibold">{name}</span>
      <span className="flex gap-4">
        <a href={print} className={linkClass} aria-label={many ? `See how ${name} prints` : undefined}>
          See how it prints
        </a>
        <a href={download} className={linkClass} aria-label={many ? `Download ${name}` : undefined}>
          Download
        </a>
      </span>
    </div>
  );
  const pdf = (
    <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
      {many ? chosen.map((x) => file(`${nameOf(x)}.pdf`, x.printHref, x.pdfHref)) : file(fileName, printHref, pdfHref)}
    </div>
  );
  const after = [`The inquiry becomes Quoted; next, record ${customer}’s answer.`];
  const names = namesOf(chosen, true);
  return (
    <PanelBody>
      {!again && (
        <fieldset className="mb-5 flex flex-col gap-2">
          <legend className="mb-2 text-xs font-bold text-text-2">How does it go to the customer?</legend>
          {choice("email", "Email it from here", "With the PDF attached")}
          {choice("self", "I sent it myself", "WhatsApp, WeChat, in person: only mark it as sent")}
        </fieldset>
      )}
      {by === "email" || again ? (
        <ActionForm key="email" action={emailAction} onDone={(st) => close(st)} className={PANEL_FORM}>
          {(s) => (
            <>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="To" htmlFor="send-to" required error={s.errors?.to} hint="Several: separate them with commas">
                  <Input id="send-to" name="to" type="text" inputMode="email" defaultValue={s.values?.to ?? to} />
                </Field>
                <Field label="Copy" htmlFor="send-cc" optional error={s.errors?.cc}>
                  <Input id="send-cc" name="cc" type="text" inputMode="email" defaultValue={s.values?.cc ?? cc} />
                </Field>
              </div>
              <Field label="Subject" htmlFor="send-subject" error={s.errors?.subject}>
                <Input id="send-subject" name="subject" maxLength={300} value={subjectNow} onChange={(e) => setSubjectTyped(e.target.value)} />
              </Field>
              {include}
              <Field label="Message" htmlFor="send-message" error={s.errors?.message}>
                <Textarea id="send-message" name="message" rows={4} value={messageNow} onChange={(e) => setMessageTyped(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="attach" defaultChecked className="size-[18px] accent-primary" />
                {many ? "Attach the PDFs" : "Attach the PDF"}
              </label>
              {pdf}
              <WhatHappens
                lines={
                  again
                    ? ["The email goes out with the same PDF.", `R${number} does not change: it stays as it was sent.`]
                    : many
                      ? [`One email goes out with the ${chosen.length} PDFs.`, `${names} become Sent: by email, today. Each is then kept exactly as sent.`, ...after]
                      : ["The email goes out with the PDF.", `R${number} becomes Sent: by email, today. It is then kept exactly as sent.`, ...after]
                }
              />
              <WindowFooter>
                <SubmitButton pendingText="Sending…">
                  <Mail aria-hidden /> {many ? `Send ${chosen.length}` : "Send email"}
                </SubmitButton>
              </WindowFooter>
            </>
          )}
        </ActionForm>
      ) : (
        <ActionForm key="self" action={markAction!} onDone={(st) => close(st)} className={PANEL_FORM}>
          {(s) => (
            <>
              <input type="hidden" name="to" value="sent" />
              <input type="hidden" name="via" value={how} />
              <input type="hidden" name="reason" value={`Sent ${SENT_VIA_TEXT[how]}`} />
              <div className={RULES.form.fields}>
                <Field label="How" htmlFor="sent-how">
                  <Select id="sent-how" value={how} onChange={(e) => setHow(e.target.value as SentVia)}>
                    {SENT_VIA.map((v) => (
                      <option key={v} value={v}>
                        {SENT_VIA_LABEL[v]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sent on" htmlFor="sent-on" optional error={s.errors?.on}>
                  <Input id="sent-on" name="on" type="date" max={today} defaultValue={s.values?.on} />
                </Field>
              </div>
              {include}
              {pdf}
              <WhatHappens
                lines={[
                  "Nothing is sent by the system.",
                  many ? `${names} become Sent: ${SENT_VIA_TEXT[how]}. Each is then kept exactly as sent.` : `R${number} becomes Sent: ${SENT_VIA_TEXT[how]}. It is then kept exactly as sent.`,
                  ...after,
                ]}
              />
              <WindowFooter>
                <SubmitButton pendingText="Saving…">
                  <Check aria-hidden /> {many ? `Mark ${chosen.length} as sent` : `Mark R${number} as sent`}
                </SubmitButton>
              </WindowFooter>
            </>
          )}
        </ActionForm>
      )}
    </PanelBody>
  );
}

