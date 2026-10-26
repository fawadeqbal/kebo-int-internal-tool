"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleSlash, Lock } from "lucide-react";
import { TEAM_LABEL, type OrderPlan, type PlannedStep } from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const dueText = (s: PlannedStep) => {
  if (s.status !== "todo") return null;
  if (!s.due) return "No date yet";
  if (s.dueInDays === null) return `Due ${s.due}`;
  if (s.dueInDays < 0) return `${-s.dueInDays} day${s.dueInDays === -1 ? "" : "s"} late (due ${s.due})`;
  if (s.dueInDays === 0) return "Due today";
  return `Due ${s.due} · in ${s.dueInDays} day${s.dueInDays === 1 ? "" : "s"}`;
};

function StepForm({ step, action, canOverride, mode, onClose }: { step: PlannedStep; action: Action; canOverride: boolean; mode: "done" | "skip"; onClose: () => void }) {
  const needsNote = (mode === "done" && !!step.blockedBy) || (mode === "skip" && !step.optional);
  return (
    <ActionForm action={action} onDone={onClose} className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3">
      {(state) => (
        <>
          <input type="hidden" name="key" value={step.key} />
          <input type="hidden" name="action" value={mode} />
          {needsNote && (
            <p className="flex gap-2 text-sm text-warn">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {mode === "done" ? step.blockedBy!.message : "This step is required."} {canOverride ? "As a manager you can go ahead: write why." : "Ask a manager."}
            </p>
          )}
          {mode === "done" && (
            <Field label="Done on" htmlFor={`on-${step.key}`} optional hint="Today when empty">
              <Input id={`on-${step.key}`} name="on" type="date" defaultValue={state.values?.on} />
            </Field>
          )}
          <Field label={needsNote ? "Why" : "Note"} optional={!needsNote} htmlFor={`note-${step.key}`} error={state.errors?.note}>
            <Textarea id={`note-${step.key}`} name="note" rows={2} className="min-h-0" defaultValue={state.values?.note} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…" disabled={needsNote && !canOverride}>
              {mode === "done" ? "Mark done" : "Skip this step"}
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function Undo({ step, action }: { step: PlannedStep; action: Action }) {
  return (
    <ActionForm action={action} className="inline" showSuccess={false}>
      {(state) => (
        <>
          <input type="hidden" name="key" value={step.key} />
          <input type="hidden" name="action" value="undo" />
          <button type="submit" className="text-xs font-medium text-muted underline-offset-2 hover:text-text hover:underline">
            Undo
          </button>
          {state.message && state.ok === false && <span className="ml-2 text-xs text-bad">{state.message}</span>}
        </>
      )}
    </ActionForm>
  );
}

/**
 * The order's checklist: every step in the order the payment terms set, with
 * its due date, what it is waiting for, and the buttons to record it.
 */
export function Checklist({ plan, action, canEdit, canOverride, open }: { plan: OrderPlan; action: Action; canEdit: boolean; canOverride: boolean; open: boolean }) {
  const [form, setForm] = useState<{ key: string; mode: "done" | "skip" } | null>(null);
  return (
    <ol className="flex flex-col">
      {plan.steps.map((s, i) => {
        const isNext = plan.next?.key === s.key;
        const Icon = s.status === "done" ? CheckCircle2 : s.status === "skipped" ? CircleSlash : s.blockedBy ? Lock : Circle;
        return (
          <li key={s.key} id={`step-${s.key}`} className={cn("relative flex gap-3 border-line py-3", i > 0 && "border-t", isNext && "rounded-lg border-transparent bg-primary-soft/40 px-3 -mx-3")}>
            <Icon className={cn("mt-0.5 size-5 shrink-0", s.status === "done" ? "text-ok" : s.status === "skipped" ? "text-muted" : s.overdue ? "text-bad" : isNext ? "text-primary" : "text-line-strong")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("text-sm font-medium", s.status === "skipped" && "text-muted line-through")}>{s.status === "done" ? s.doneTitle : s.title}</span>
                {isNext && <Badge tone="primary">Next</Badge>}
                {s.optional && s.status === "todo" && <Badge tone="outline">Optional</Badge>}
                <span className="text-xs text-muted">{TEAM_LABEL[s.team]}</span>
              </div>
              <p className={cn("mt-0.5 text-xs", s.overdue ? "font-medium text-bad" : "text-muted")}>
                {s.status === "done" ? `Done ${s.doneOn ?? ""}` : s.status === "skipped" ? "Skipped" : dueText(s)}
                {s.hint && s.status === "todo" ? ` · ${s.hint}` : ""}
              </p>
              {s.blockedBy && s.status === "todo" && (
                <p className="mt-1 flex items-center gap-1 text-xs text-warn">
                  <Lock className="size-3" aria-hidden /> {s.blockedBy.message}
                </p>
              )}
              {form?.key === s.key && <StepForm step={s} action={action} canOverride={canOverride} mode={form.mode} onClose={() => setForm(null)} />}
            </div>
            {canEdit && open && form?.key !== s.key && (
              <div className="flex shrink-0 items-start gap-2">
                {s.status === "todo" ? (
                  <>
                    <Button size="xs" variant={isNext ? "primary" : "secondary"} onClick={() => setForm({ key: s.key, mode: "done" })}>
                      Done
                    </Button>
                    {(s.optional || canOverride) && (
                      <Button size="xs" variant="ghost" onClick={() => setForm({ key: s.key, mode: "skip" })}>
                        Skip
                      </Button>
                    )}
                  </>
                ) : (
                  <Undo step={s} action={action} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
