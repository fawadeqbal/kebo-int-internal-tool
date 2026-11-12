"use client";

import { useRouter } from "next/navigation";
import { Download, Mail } from "lucide-react";
import { buttonClass, Card, CardBody, CardHeader, Field, Input, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "Send R2" (board QuoteSend): to, copy, subject and message, with the PDF
 * attached; Download PDF; or "Sent another way — mark as sent".
 */
export function SendQuoteCard({
  number,
  action,
  to,
  cc,
  subject,
  message,
  pdfHref,
  markSent,
  backHref,
}: {
  number: number;
  action: Action;
  to: string;
  cc: string;
  subject: string;
  message: string;
  pdfHref: string;
  /** "Sent another way — mark as sent" (the small panel). */
  markSent: React.ReactNode;
  backHref: string;
}) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader title={`Send R${number}`} />
      <CardBody>
        <ActionForm action={action} onDone={() => router.push(backHref)} className="flex flex-col gap-4">
          {(s) => (
            <>
              <Field label="To" htmlFor="send-to" required error={s.errors?.to} hint="Several: separate them with commas">
                <Input id="send-to" name="to" type="text" inputMode="email" defaultValue={s.values?.to ?? to} />
              </Field>
              <Field label="Copy" htmlFor="send-cc" error={s.errors?.cc}>
                <Input id="send-cc" name="cc" type="text" inputMode="email" defaultValue={s.values?.cc ?? cc} />
              </Field>
              <Field label="Subject" htmlFor="send-subject" error={s.errors?.subject}>
                <Input id="send-subject" name="subject" maxLength={300} defaultValue={s.values?.subject ?? subject} />
              </Field>
              <Field label="Message" htmlFor="send-message" error={s.errors?.message}>
                <Textarea id="send-message" name="message" rows={4} defaultValue={s.values?.message ?? message} />
              </Field>
              <label className="flex items-center gap-2.5 py-1 text-sm">
                <input type="checkbox" name="attach" defaultChecked className="size-[18px] accent-primary" />
                Attach the PDF
              </label>
              <div className="flex flex-col items-start gap-3">
                <SubmitButton pendingText="Sending…">
                  <Mail aria-hidden /> Send email
                </SubmitButton>
                <a href={pdfHref} className={buttonClass("secondary", "md")}>
                  <Download aria-hidden /> Download PDF
                </a>
              </div>
            </>
          )}
        </ActionForm>
        <div className="mt-3">{markSent}</div>
      </CardBody>
    </Card>
  );
}
