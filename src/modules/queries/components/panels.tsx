"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Select, Textarea } from "@/components/ui";
import { ConfirmSubmit, SubmitButton } from "@/components/ui/client";
import type { ActionState } from "@/lib/utils/result";
import type { QueryStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function StatusPanel({
  action,
  transitions,
}: {
  action: Action;
  transitions: { to: QueryStatus; label: string; reopen?: boolean }[];
}) {
  const [state, formAction] = useActionState(action, {});
  const [choice, setChoice] = useState<QueryStatus | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [seenState, setSeenState] = useState(state);
  // After a successful change, close the confirmation box.
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) setChoice(null);
  }

  if (transitions.length === 0) return <p className="text-sm text-muted">No status changes are available.</p>;

  const needsReason = choice === "not_completed";
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <button
            key={t.to}
            type="button"
            onClick={() => setChoice(choice === t.to ? null : t.to)}
            aria-pressed={choice === t.to}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
              choice === t.to
                ? "border-brand-600 bg-brand-600 text-white"
                : t.to === "not_completed"
                  ? "border-line text-red-700 hover:border-red-300 hover:bg-red-50"
                  : t.to === "completed"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    : "border-line bg-surface hover:bg-canvas",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {choice && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas/50 p-3">
          <input type="hidden" name="status" value={choice} />
          <Field
            label={needsReason ? "Reason (required)" : "Note (optional)"}
            htmlFor="reason"
            error={state.errors?.reason}
            hint={needsReason ? "e.g. customer cancelled, price not accepted, not feasible" : "Visible in the activity history"}
          >
            <Textarea id="reason" name="reason" rows={2} className="min-h-0" autoFocus={needsReason} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" variant={needsReason ? "danger" : "primary"} pendingText="Updating…">
              Confirm
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChoice(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

export function AssignPanel({
  action,
  people,
  current,
  canAssignOthers,
  currentUserId,
}: {
  action: Action;
  people: { id: string; name: string }[];
  current: string | null;
  canAssignOthers: boolean;
  currentUserId: string;
}) {
  const [state, formAction] = useActionState(action, {});
  if (!canAssignOthers) {
    if (current) return null;
    return (
      <form action={formAction} className="flex flex-col gap-2">
        {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
        <input type="hidden" name="assignedTo" value={currentUserId} />
        <SubmitButton size="sm" variant="secondary">
          Assign to me
        </SubmitButton>
      </form>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <label htmlFor="assignedTo" className="sr-only">
        Assign to
      </label>
      <div className="flex gap-2">
        <Select id="assignedTo" name="assignedTo" defaultValue={current ?? ""} className="h-9" key={current ?? "none"}>
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === currentUserId ? `${p.name} (me)` : p.name}
            </option>
          ))}
        </Select>
        <SubmitButton size="sm" variant="secondary" pendingText="…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

export function CommentForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-2">
      <label htmlFor="body" className="sr-only">
        Add a note
      </label>
      <Textarea
        id="body"
        name="body"
        rows={3}
        placeholder="Add an internal note — e.g. called the customer, waiting for drawings…"
        aria-invalid={!!state.errors?.body}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ref.current?.requestSubmit();
        }}
      />
      {state.errors?.body && <p className="text-xs font-medium text-red-600">{state.errors.body[0]}</p>}
      {state.message && !state.ok && !state.errors && <Alert tone="error">{state.message}</Alert>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">Ctrl + Enter to post</span>
        <SubmitButton size="sm" pendingText="Posting…">
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}

export function RemoveFileButton({ action, fileName }: { action: () => Promise<ActionState>; fileName: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline">
      <ConfirmSubmit size="sm" variant="ghost" message={`Remove ${fileName}?`} pendingText="…" aria-label={`Remove ${fileName}`}>
        Remove
      </ConfirmSubmit>
      {state.message && !state.ok && <span className="ml-2 text-xs text-red-600">{state.message}</span>}
    </form>
  );
}
