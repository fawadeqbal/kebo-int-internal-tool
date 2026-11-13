"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Mail, Trash2 } from "lucide-react";
import { SENT_VIA, SENT_VIA_LABEL, SENT_VIA_TEXT, type SentVia } from "@kebo/shared";
import { Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { ConfirmDialog } from "@/components/common/dialog";
import { PANEL_FORM, PanelBody, PanelFooter, useClosePanel, WhatHappens } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "Send R1 to <customer>": one window, two choices. Email it from here (to, copy, subject, message, the PDF
 * attached), or "I sent it myself" (how and when; nothing leaves the system). Each says what happens above
 * its button. A revision already sent has only the email ("Send again"): nothing about it changes.
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
}: {
  number: number;
  customer: string;
  emailAction: Action;
  /** Marks it sent without sending anything (null: it is sent already). */
  markAction: Action | null;
  to: string;
  cc: string;
  subject: string;
  message: string;
  fileName: string;
  printHref: string;
  pdfHref: string;
  today: string;
}) {
  const close = useClosePanel();
  const [by, setBy] = useState<"email" | "self">("email");
  const [how, setHow] = useState<SentVia>("whatsapp");
  const again = !markAction;
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
  const pdf = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5 text-[13px]">
      <span className="font-semibold">{fileName}</span>
      <span className="flex gap-4">
        <a href={printHref} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
          See how it prints
        </a>
        <a href={pdfHref} className="font-medium text-primary hover:underline">
          Download
        </a>
      </span>
    </div>
  );
  const after = [`The inquiry becomes Quoted. “Do next” becomes “Record ${customer}’s answer”.`];
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
                <Input id="send-subject" name="subject" maxLength={300} defaultValue={s.values?.subject ?? subject} />
              </Field>
              <Field label="Message" htmlFor="send-message" error={s.errors?.message}>
                <Textarea id="send-message" name="message" rows={4} defaultValue={s.values?.message ?? message} />
              </Field>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="attach" defaultChecked className="size-[18px] accent-primary" />
                Attach the PDF
              </label>
              {pdf}
              <WhatHappens
                lines={
                  again
                    ? ["The email goes out with the same PDF.", `R${number} does not change: it stays as it was sent.`]
                    : ["The email goes out with the PDF.", `R${number} becomes Sent: by email, today. It is then kept exactly as sent.`, ...after]
                }
              />
              <PanelFooter>
                <Button type="button" variant="ghost" onClick={() => close()}>
                  Cancel
                </Button>
                <SubmitButton pendingText="Sending…">
                  <Mail aria-hidden /> Send email
                </SubmitButton>
              </PanelFooter>
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
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="How" htmlFor="sent-how">
                  <Select id="sent-how" value={how} onChange={(e) => setHow(e.target.value as SentVia)}>
                    {SENT_VIA.map((v) => (
                      <option key={v} value={v}>
                        {SENT_VIA_LABEL[v]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sent on" htmlFor="sent-on" optional hint="Today when empty" error={s.errors?.on}>
                  <Input id="sent-on" name="on" type="date" max={today} defaultValue={s.values?.on} />
                </Field>
              </div>
              {pdf}
              <WhatHappens lines={["Nothing is sent by the system.", `R${number} becomes Sent: ${SENT_VIA_TEXT[how]}. It is then kept exactly as sent.`, ...after]} />
              <PanelFooter>
                <Button type="button" variant="ghost" onClick={() => close()}>
                  Cancel
                </Button>
                <SubmitButton pendingText="Saving…">
                  <Check aria-hidden /> Mark R{number} as sent
                </SubmitButton>
              </PanelFooter>
            </>
          )}
        </ActionForm>
      )}
    </PanelBody>
  );
}

/** "Delete draft" on the draft's line: asks first and says what happens. */
export function DeleteDraftButton({ number, action, backHref }: { number: number; action: Action; backHref: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setAsking(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-bad hover:underline">
        <Trash2 className="size-4" aria-hidden /> Delete draft
      </button>
      {asking && (
        <ConfirmDialog
          title={`Delete draft R${number}?`}
          confirmLabel="Delete the draft"
          cancelLabel="Keep it"
          danger
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() =>
            start(async () => {
              const r = await action({}, new FormData());
              setAsking(false);
              if (!r.ok) return toast(r.message ?? "The draft was not deleted.");
              router.replace(backHref);
              router.refresh();
            })
          }
        >
          <WhatHappens lines={[`Draft R${number} and the prices set in it are removed.`, "The factory offers stay as they are.", number > 1 ? `R${number - 1} stays as it is.` : "With no other revision, the tab goes back to “No quotation yet”."]} />
        </ConfirmDialog>
      )}
    </>
  );
}
