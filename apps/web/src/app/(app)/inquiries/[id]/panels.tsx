"use client";

import { Clock } from "lucide-react";
import { LOST_REASON_LABEL, LOST_REASONS, MANUAL_MOVES, type InquiryStage } from "@kebo/shared";
import { Button, Field, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelButton } from "@/components/orders/step-view";
import { PANEL_FORM, PanelActions, PanelBody, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A panel form's Save / Cancel. */
function Buttons({ save, danger }: { save: string; danger?: boolean }) {
  const close = useClosePanel();
  return (
    <PanelActions>
      <SubmitButton size="sm" variant={danger ? "danger" : "primary"} pendingText="Saving…">
        {save}
      </SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={close}>
        Cancel
      </Button>
    </PanelActions>
  );
}

/** Mark lost (with a reason), start working, or reopen: the moves people make by hand. Everything else moves by itself. */
function StageForm({ to, action }: { to: InquiryStage; action: Action }) {
  const close = useClosePanel();
  const lost = to === "lost";
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
        {(s) => (
          <>
            <input type="hidden" name="to" value={to} />
            {lost && (
              <fieldset className="flex flex-col gap-2.5">
                <legend className="mb-2 text-[13px] font-semibold">
                  Why was it lost? <span className="text-bad">*</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {LOST_REASONS.map((r) => (
                    <label
                      key={r}
                      className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-line px-3 py-2.5 text-sm has-[:checked]:border-primary-solid has-[:checked]:bg-primary-soft/50"
                    >
                      <input type="radio" name="lostReason" value={r} defaultChecked={s.values?.lostReason === r} required className="accent-primary-solid" />
                      {LOST_REASON_LABEL[r]}
                    </label>
                  ))}
                </div>
                {s.errors?.lostReason && <p className="text-xs text-bad">{s.errors.lostReason[0]}</p>}
              </fieldset>
            )}
            <Field label="Note" htmlFor="note">
              <Textarea id="note" name="note" rows={3} className="min-h-0" defaultValue={s.values?.note} />
            </Field>
            {lost && <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-text-2">A quotation sent and not answered is marked “rejected”. You can reopen the inquiry later.</p>}
            <Buttons save={lost ? "Mark lost" : "Confirm"} danger={lost} />
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
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
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
  refNo,
  only,
}: {
  refNo?: string;
  /** Just the hold button (the on-hold banner). */
  only?: "hold";
  stage: InquiryStage;
  onHold: boolean;
  canHold: boolean;
  canReopen: boolean;
  stageAction: Action;
  holdAction: Action;
}) {
  const moves = only ? [] : MANUAL_MOVES[stage].filter((m) => !m.reopen || canReopen);
  if (!moves.length && !canHold) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canHold && (
        <PanelButton
          variant="secondary"
          size="sm"
          icon={<Clock aria-hidden />}
          label={onHold ? "Take off hold" : "Put on hold"}
          title={onHold ? "Resume the inquiry" : "Put the inquiry on hold"}
          description={onHold ? "It goes back to the lists as active." : "It stays where it is, marked on hold, until resumed."}
          body={<HoldForm onHold={onHold} action={holdAction} />}
        />
      )}
      {moves.map((m) => (
        <PanelButton
          key={m.to}
          variant="secondary"
          size="sm"
          className={m.to === "lost" ? "border-bad/40 text-bad hover:bg-bad-soft" : undefined}
          label={m.to === "lost" ? "Mark lost…" : m.label}
          title={m.to === "lost" ? `Mark ${refNo ?? "the inquiry"} as lost` : m.label}
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
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
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

/** "Handles it" (board): a list that saves as soon as another person is chosen. */
export function AssignSelect({ action, people, current }: { action: Action; people: { id: string; name: string }[]; current: string | null }) {
  return (
    <ActionForm action={action} showSuccess={false}>
      <Field label="Handles it" htmlFor="handles-it">
        <Select id="handles-it" name="assigneeId" defaultValue={current ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess showSuccess={false} className="flex flex-col gap-2">
      {(s) => (
        <>
          <label htmlFor="inquiry-note" className="text-[13px] font-medium text-text-2">
            Add a note
          </label>
          <Textarea id="inquiry-note" name="body" rows={2} placeholder="Write a note or @mention someone" className="min-h-0" />
          {s.errors?.body && <p className="text-xs text-bad">{s.errors.body[0]}</p>}
          <div>
            <SubmitButton size="sm" variant="secondary" pendingText="Adding…">
              Add note
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
