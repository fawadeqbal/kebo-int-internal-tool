"use client";

import { useState } from "react";
import { LOST_REASON_LABEL, LOST_REASONS, MANUAL_MOVES, type InquiryStage } from "@kebo/shared";
import { Button, Field, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The two decisions people make by hand: mark lost (with a reason) or start / reopen. Everything else moves by itself. */
export function StagePanel({ stage, action, canReopen }: { stage: InquiryStage; action: Action; canReopen: boolean }) {
  const moves = MANUAL_MOVES[stage].filter((m) => !m.reopen || canReopen);
  const [to, setTo] = useState<InquiryStage | null>(null);
  if (!moves.length) return <p className="text-sm text-muted">{stage === "won" ? "Changes now go through the order." : "Closed."}</p>;
  const lost = to === "lost";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {moves.map((m) => (
          <Button
            key={m.to}
            size="sm"
            variant={m.to === "lost" ? "danger-ghost" : "secondary"}
            onClick={() => setTo(to === m.to ? null : m.to)}
            aria-pressed={to === m.to}
          >
            {m.label}
          </Button>
        ))}
      </div>
      {to && (
        <ActionForm
          action={action}
          onDone={() => setTo(null)}
          className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3"
        >
          {(s) => (
            <>
              <input type="hidden" name="to" value={to} />
              {lost && (
                <Field label="Why was it lost?" htmlFor="lostReason" error={s.errors?.lostReason}>
                  <Select id="lostReason" name="lostReason" defaultValue={s.values?.lostReason ?? ""}>
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {LOST_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {LOST_REASON_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Note" optional htmlFor="note">
                <Textarea id="note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
              </Field>
              <div className="flex gap-2">
                <SubmitButton size="sm" variant={lost ? "danger" : "primary"} pendingText="Saving…">
                  Confirm
                </SubmitButton>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTo(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}

export function HoldPanel({ onHold, action }: { onHold: boolean; action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {onHold ? "Resume" : "Put on hold"}
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className="flex flex-col gap-3">
      <input type="hidden" name="onHold" value={onHold ? "false" : "true"} />
      <Field label={onHold ? "Note" : "What are we waiting for?"} optional={onHold} htmlFor="hold-note">
        <Textarea
          id="hold-note"
          name="note"
          rows={2}
          className="min-h-0"
          placeholder={onHold ? "" : "e.g. new drawings from the customer"}
        />
      </Field>
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingText="Saving…">
          {onHold ? "Resume" : "Put on hold"}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

export function AssignPanel({
  action,
  people,
  current,
  canAssignOthers,
  meId,
}: {
  action: Action;
  people: { id: string; name: string }[];
  current: string | null;
  canAssignOthers: boolean;
  meId: string;
}) {
  if (!canAssignOthers)
    return current ? null : (
      <ActionForm action={action}>
        <input type="hidden" name="assigneeId" value={meId} />
        <SubmitButton size="sm" pendingText="Saving…">
          Take it
        </SubmitButton>
      </ActionForm>
    );
  return (
    <ActionForm action={action} className="flex items-end gap-2">
      <Field label="Handled by" htmlFor="assigneeId" className="flex-1">
        <Select id="assigneeId" name="assigneeId" defaultValue={current ?? ""}>
          <option value="">Nobody</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess showSuccess={false} className="flex flex-col gap-2">
      {(s) => (
        <>
          <Textarea name="body" rows={2} placeholder="Add a note for the team…" aria-label="Note" className="min-h-0" />
          {s.errors?.body && <p className="text-xs text-bad">{s.errors.body[0]}</p>}
          <div>
            <SubmitButton size="sm" variant="secondary" pendingText="Posting…">
              Post note
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function UploadForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        name="file"
        aria-label="File"
        className="text-sm file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-sm"
      />
      <SubmitButton size="sm" variant="secondary" pendingText="Uploading…">
        Upload
      </SubmitButton>
    </ActionForm>
  );
}

export function RemoveFile({ action, name }: { action: Action; name: string }) {
  return (
    <ActionForm action={action} showSuccess={false} className="inline">
      <button
        type="submit"
        className="text-xs text-muted hover:text-bad"
        aria-label={`Remove ${name}`}
        onClick={(e) => !confirm(`Remove ${name}?`) && e.preventDefault()}
      >
        Remove
      </button>
    </ActionForm>
  );
}
