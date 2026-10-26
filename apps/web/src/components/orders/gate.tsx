"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Field, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

export type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Codes the API answers with (409) when a step that this record ticks is not allowed yet. */
const GATE_CODES = ["note_required", "deposit_first", "inspect_first", "balance_first", "dependents_done"];

export const isGate = (s: ActionState) => !!s.code && GATE_CODES.includes(s.code);
/** A manager can go ahead by writing why. */
export const needsNote = (s: ActionState, canOverride: boolean) => canOverride && s.code === "note_required";

/**
 * Under the API's message: what the gate is about (from the checklist) and
 * what the person can do: managers write why and try again; others ask.
 */
export function GateHelp({ state, canOverride, reason }: { state: ActionState; canOverride: boolean; reason?: string | null }) {
  if (!isGate(state)) return null;
  const why = state.code === "note_required" && reason ? `${reason} ` : "";
  return (
    <p className="flex gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-text">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <span>
        {why}
        {canOverride && state.code === "note_required"
          ? "As a manager you can go ahead: write why in the note, then try again. Nothing was saved yet."
          : canOverride
            ? "Nothing was saved. Finish that step first, or write why in the note to go ahead."
            : "Nothing was saved. Finish that step first or ask a manager to go ahead."}
      </span>
    </p>
  );
}

/**
 * The note field of a form that may hit a gate. The API takes a manager's note
 * as the reason to go past a gate, so while a gate is closed the field is held
 * back until the API asks for it; then it becomes "Why are you going ahead?".
 */
export function NoteField({
  id,
  state,
  canOverride,
  label = "Note",
  rows = 2,
  gated = false,
}: {
  id: string;
  state: ActionState;
  canOverride: boolean;
  label?: string;
  rows?: number;
  gated?: boolean;
}) {
  const why = needsNote(state, canOverride);
  if (gated && !why) return null;
  return (
    <Field label={why ? "Why are you going ahead?" : label} optional={!why} htmlFor={id} error={state.errors?.note}>
      <Textarea
        id={id}
        name="note"
        rows={rows}
        className="min-h-0"
        defaultValue={state.values?.note}
        autoFocus={why}
        aria-invalid={why || undefined}
      />
    </Field>
  );
}

/** A button that opens a small form under it (one per row: send, confirm, void…). */
export function InlineAction({
  label,
  action,
  variant = "secondary",
  submitLabel,
  submitVariant = "primary",
  confirm,
  children,
  defaultOpen = false,
  disabled,
}: {
  label: ReactNode;
  action: Action;
  variant?: "primary" | "secondary" | "ghost" | "danger-ghost";
  submitLabel: string;
  submitVariant?: "primary" | "danger";
  confirm?: string;
  children?: (s: ActionState) => ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open)
    return (
      <Button size="xs" variant={variant} onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </Button>
    );
  return (
    <ActionForm
      action={action}
      onDone={() => setOpen(false)}
      className="flex w-full flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3"
    >
      {(s) => (
        <>
          {children?.(s)}
          <div className="flex gap-2">
            <SubmitButton
              size="sm"
              variant={submitVariant}
              pendingText="Saving…"
              onClick={
                confirm
                  ? (e) => {
                      if (!window.confirm(confirm)) e.preventDefault();
                    }
                  : undefined
              }
            >
              {submitLabel}
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
