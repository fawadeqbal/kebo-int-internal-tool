"use client";

import { LOST_REASON_LABEL, LOST_REASONS, MANUAL_MOVES, type InquiryStage } from "@kebo/shared";
import { Button, Field, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelBody, PanelButton, useClosePanel } from "@/components/orders/step-view";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A panel form's Save / Cancel. */
function Buttons({ save, danger }: { save: string; danger?: boolean }) {
  const close = useClosePanel();
  return (
    <div className="flex gap-2">
      <SubmitButton size="sm" variant={danger ? "danger" : "primary"} pendingText="Saving…">
        {save}
      </SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={close}>
        Cancel
      </Button>
    </div>
  );
}

/** Mark lost (with a reason), start working, or reopen: the moves people make by hand. Everything else moves by itself. */
function StageForm({ to, action }: { to: InquiryStage; action: Action }) {
  const close = useClosePanel();
  const lost = to === "lost";
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className="flex flex-col gap-3">
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
              <Textarea id="note" name="note" rows={3} className="min-h-0" defaultValue={s.values?.note} />
            </Field>
            <Buttons save="Confirm" danger={lost} />
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

function HoldForm({ onHold, action }: { onHold: boolean; action: Action }) {
  const close = useClosePanel();
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className="flex flex-col gap-3">
        <input type="hidden" name="onHold" value={onHold ? "false" : "true"} />
        <Field label={onHold ? "Note" : "What are we waiting for?"} optional={onHold} htmlFor="hold-note">
          <Textarea id="hold-note" name="note" rows={3} className="min-h-0" placeholder={onHold ? "" : "e.g. new drawings from the customer"} />
        </Field>
        <Buttons save={onHold ? "Resume" : "Put on hold"} />
      </ActionForm>
    </PanelBody>
  );
}

/** The quiet decisions under the side cards: put on hold / resume, mark as lost, start, reopen. */
export function DecisionButtons({
  stage,
  onHold,
  canHold,
  canReopen,
  stageAction,
  holdAction,
}: {
  stage: InquiryStage;
  onHold: boolean;
  canHold: boolean;
  canReopen: boolean;
  stageAction: Action;
  holdAction: Action;
}) {
  const moves = MANUAL_MOVES[stage].filter((m) => !m.reopen || canReopen);
  if (!moves.length && !canHold) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {canHold && (
        <PanelButton
          variant="ghost"
          size="sm"
          label={onHold ? "Resume" : "Put on hold"}
          title={onHold ? "Resume the inquiry" : "Put the inquiry on hold"}
          description={onHold ? "It goes back to the lists as active." : "It stays where it is, marked on hold, until resumed."}
          body={<HoldForm onHold={onHold} action={holdAction} />}
        />
      )}
      {moves.map((m) => (
        <PanelButton
          key={m.to}
          variant="ghost"
          size="sm"
          label={m.to === "lost" ? "Mark as lost" : m.label}
          title={m.to === "lost" ? "Mark the inquiry as lost" : m.label}
          description={m.to === "lost" ? "The reason shows on reports. A manager can reopen it." : undefined}
          body={<StageForm to={m.to} action={stageAction} />}
        />
      ))}
    </div>
  );
}

/** Handled by: choose who (managers), or take it yourself. */
export function AssignForm({
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
  const close = useClosePanel();
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className="flex flex-col gap-3">
        {(s) =>
          canAssignOthers ? (
            <>
              <Field label="Handled by" htmlFor="assigneeId">
                <Select id="assigneeId" name="assigneeId" defaultValue={s.values?.assigneeId ?? current ?? ""}>
                  <option value="">Nobody</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Buttons save="Save" />
            </>
          ) : (
            <>
              <input type="hidden" name="assigneeId" value={meId} />
              <p className="text-sm text-text-2">You will handle this inquiry.</p>
              <Buttons save="Take it" />
            </>
          )
        }
      </ActionForm>
    </PanelBody>
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
