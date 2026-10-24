"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Avatar, Button, buttonClass, Field, Select, Textarea } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
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
              buttonClass(choice === t.to ? "primary" : t.to === "not_completed" ? "danger-ghost" : "secondary", "sm"),
              t.to === "not_completed" && choice !== t.to && "border border-line",
              t.to === "completed" && choice !== t.to && "border-ok/30 text-ok",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {choice && (
        <div className="flex animate-in flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3">
          <input type="hidden" name="status" value={choice} />
          <Field
            label={needsReason ? "Reason" : "Note"}
            optional={!needsReason}
            htmlFor="reason"
            error={state.errors?.reason}
            hint={needsReason ? "e.g. bought elsewhere, price too high, factory can't supply" : "Shown in the activity history"}
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

/**
 * Who handles the inquiry: shown as a name, with "Change" to pick someone else
 * (managers) or "Assign to me" (staff, when nobody has it yet).
 */
export function AssignPanel({
  action,
  people,
  current,
  currentName,
  canAssignOthers,
  currentUserId,
}: {
  action: Action;
  people: { id: string; name: string }[];
  current: string | null;
  currentName: string | null;
  canAssignOthers: boolean;
  currentUserId: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [editing, setEditing] = useState(false);
  const shown = (
    <div className="flex items-center justify-between gap-3">
      {currentName ? (
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-text">
          <Avatar name={currentName} size={26} />
          <span className="truncate">{currentName}</span>
        </p>
      ) : (
        <Badge tone="warn">Not assigned yet</Badge>
      )}
      {canAssignOthers && !editing && (
        <Button type="button" variant="secondary" size="xs" onClick={() => setEditing(true)}>
          {current ? "Change" : "Assign"}
        </Button>
      )}
    </div>
  );
  if (!canAssignOthers) {
    return (
      <div className="flex flex-col gap-3">
        {shown}
        {!current && (
          <form action={formAction} className="flex flex-col gap-2">
            {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
            <input type="hidden" name="assignedTo" value={currentUserId} />
            <SubmitButton size="sm" variant="secondary">
              Assign to me
            </SubmitButton>
          </form>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      {shown}
      {editing && (
        <form
          action={async (fd) => {
            await formAction(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="assignedTo" className="sr-only">
            Assign to
          </label>
          <Select id="assignedTo" name="assignedTo" defaultValue={current ?? ""} key={current ?? "none"} autoFocus>
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentUserId ? `${p.name} (me)` : p.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
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
        placeholder="Add a note, e.g. asked 3 factories for prices, customer sending drawings…"
        aria-invalid={!!state.errors?.body}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ref.current?.requestSubmit();
        }}
      />
      {state.errors?.body && <p className="text-xs text-bad">{state.errors.body[0]}</p>}
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
      <ConfirmSubmit size="xs" variant="danger-ghost" message={`Remove ${fileName}?`} pendingText="…" aria-label={`Remove ${fileName}`}>
        Remove
      </ConfirmSubmit>
      {state.message && !state.ok && <span className="ml-2 text-xs text-bad">{state.message}</span>}
    </form>
  );
}
