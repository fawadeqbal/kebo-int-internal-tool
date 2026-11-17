"use client";

import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";

/*
 * Editing in steps (design "one way, any number"): one window, the steps in a quiet rail on the left — each with
 * what it holds — and the step's fields beside it; Back · Save · Next at the bottom, Save from any step. On a
 * phone the rail is a thin bar with the step's name, "2 of 4" and what comes next.
 */

export interface StepInfo<K extends string> {
  key: K;
  label: string;
  /** What the step holds now, in a few words ("FOB Ningbo · 50 days"). */
  summary?: string;
  /** Filled in (a quiet check). */
  done?: boolean;
}

export function StepsFrame<K extends string>({
  steps,
  at,
  onGo,
  heading,
  children,
  footer,
}: {
  steps: StepInfo<K>[];
  at: K;
  onGo: (k: K) => void;
  /** The step's heading line (its check on the right). */
  heading?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const i = Math.max(0, steps.findIndex((s) => s.key === at));
  const current = steps[i]!;
  const next = steps[i + 1];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Phone: a thin bar of the steps, the step's name with where it is, and what comes next. */}
      <div className="border-b border-line px-4 pt-2.5 pb-3 md:hidden">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-hidden>
          {steps.map((s, k) => (
            <span key={s.key} className={cn("h-[3px] rounded-full", k < i ? "bg-text-2/70" : k === i ? "bg-text" : "bg-line")} />
          ))}
        </div>
        <p className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-base font-bold">
            {current.label}
            <span className="ml-2 text-xs font-semibold text-text-2">
              {i + 1} of {steps.length}
            </span>
          </span>
          {next && <span className="truncate text-xs text-text-2">Next: {next.label}</span>}
        </p>
      </div>
      {/* The rail stays put; only the step's own fields scroll (asked 17 Nov). */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:min-h-[min(520px,calc(100dvh-12rem))] md:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label="Steps" className="min-h-0 overflow-y-auto border-r border-line bg-surface p-3 max-md:hidden">
          <ol className="flex flex-col gap-0.5">
            {steps.map((s, k) => {
              const on = s.key === at;
              return (
                <li key={s.key} className="relative">
                  {k < steps.length - 1 && <span aria-hidden className="pointer-events-none absolute top-[34px] -bottom-2 left-[19.25px] w-[1.5px] rounded-full bg-line" />}
                  <button
                    type="button"
                    onClick={() => onGo(s.key)}
                    aria-current={on ? "step" : undefined}
                    className={cn(
                      "grid min-h-11 w-full grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3 rounded-[10px] p-2.5 text-left text-text-2 hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text",
                      on && "bg-surface-2 hover:bg-surface-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-5 place-items-center rounded-full border-[1.5px] border-line-strong text-text-2",
                        s.done && !on && "border-text-2/70",
                        on && "border-2 border-text",
                      )}
                    >
                      {s.done && !on && <Check className="size-3" strokeWidth={3.2} />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="sr-only">
                        Step {k + 1} of {steps.length}:{" "}
                      </span>
                      <span className={cn("text-sm leading-5 font-semibold", on ? "font-bold text-text" : "text-text-2")}>{s.label}</span>
                      {s.summary && <span className="line-clamp-2 text-[12.5px] leading-[17px] break-words text-text-2">{s.summary}</span>}
                      <span className="sr-only">{on ? ", current" : s.done ? ", done" : ""}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div data-step-body className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto px-6 pt-5 pb-6 *:shrink-0 max-md:px-4">
          <div className="flex min-h-7 items-center gap-3">
            <h3 className="text-lg leading-7 font-bold max-md:sr-only">{current.label}</h3>
            {heading && <span className="ml-auto">{heading}</span>}
          </div>
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}

/** Back · Save · Next: no Back on the first step; on the last, Save is the main button. Adding: the last one adds. */
export function StepsFooter({
  first,
  last,
  onBack,
  onNext,
  saveLabel = "Save",
  canSave = true,
  onCancel,
}: {
  first: boolean;
  last: boolean;
  onBack: () => void;
  onNext: () => void;
  saveLabel?: string;
  canSave?: boolean;
  /** Cancel on the first step (a new record), where there is no Back. */
  onCancel?: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface px-6 py-3 max-md:px-4">
      {first ? (
        onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )
      ) : (
        <Button type="button" variant="secondary" onClick={onBack}>
          <ChevronLeft aria-hidden /> Back
        </Button>
      )}
      <span className="flex-1" />
      <SubmitButton variant={last ? "primary" : "secondary"} pendingText="Saving…" disabled={!canSave}>
        {saveLabel}
      </SubmitButton>
      {!last && (
        <Button type="button" variant="primary" onClick={onNext}>
          Next <ChevronRight aria-hidden />
        </Button>
      )}
    </div>
  );
}
