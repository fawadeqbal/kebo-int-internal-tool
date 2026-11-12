"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Undo2 } from "lucide-react";
import { Button, Field, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { useFocusTrap, useMounted } from "@/components/common/dialog";
import { ConfirmAction } from "@/components/people/confirm-action";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * An approver's two buttons on money waiting for approval: "Send back…" (asks why, in a dialog) and
 * "Approve" (records it now as the usual payment or expense). `what` names the row for screen readers
 * ("money received · SO-2026-0447 · USD 1,000.00").
 */
export function ApproveButtons({ approve, sendBack, what }: { approve: Action; sendBack: Action; what: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <Button size="sm" variant="secondary" onClick={() => setAsking(true)} aria-haspopup="dialog" aria-label={`Send back ${what}`}>
        <Undo2 aria-hidden /> Send back…
      </Button>
      <ActionForm action={approve} showSuccess={false}>
        <SubmitButton size="sm" pendingText="Approving…" aria-label={`Approve ${what}`}>
          <Check aria-hidden /> Approve
        </SubmitButton>
      </ActionForm>
      {asking && <SendBackDialog action={sendBack} what={what} onClose={() => setAsking(false)} />}
    </div>
  );
}

/** The submitter takes back one waiting or sent back. */
export function WithdrawButton({ action }: { action: Action }) {
  return (
    <ConfirmAction
      action={action}
      label="Withdraw"
      confirm="Withdraw it? It will not be recorded, and its photo is deleted."
      pendingText="Withdrawing…"
    />
  );
}

/** "Why is it sent back?" — the reason goes to the person who added it. Escape or Cancel closes it; focus goes back to the button. */
function SendBackDialog({ action, what, onClose }: { action: Action; what: string; onClose: () => void }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  useFocusTrap(box, mounted);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center p-4" data-layer>
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
        className="relative w-full max-w-md animate-in rounded-xl border border-line bg-surface p-5 shadow-pop"
      >
        <h2 id={`${id}-t`} className="text-base font-semibold">
          Send it back
        </h2>
        <p id={`${id}-d`} className="mt-1.5 text-sm text-text-2">
          {what}. Nothing is recorded; they get your reason and can fix it and send it again.
        </p>
        <ActionForm action={action} onDone={onClose} className="mt-4">
          {(s) => (
            <>
              <Field label="Why?" htmlFor={`${id}-r`} error={s.errors?.reason} hint="Up to 500 characters">
                <Textarea
                  id={`${id}-r`}
                  name="reason"
                  rows={3}
                  maxLength={500}
                  required
                  autoFocus
                  placeholder="e.g. the slip shows USD 900, not 1,000"
                  defaultValue={s.values?.reason}
                />
              </Field>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <SubmitButton size="sm" pendingText="Sending back…">
                  Send back
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </div>
    </div>,
    document.body,
  );
}

/** "Verify chosen": the form the ticked rows belong to (their checkboxes say form="verify-chosen"). */
export function VerifyChosen({ action }: { action: Action }) {
  return (
    <ActionForm action={action} id="verify-chosen" className="flex flex-col items-end gap-1">
      <SubmitButton pendingText="Verifying…">
        <Check aria-hidden /> Verify chosen
      </SubmitButton>
    </ActionForm>
  );
}
