"use client";

import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn, RULES } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { FooterTotal, WindowCancel } from "./panel";

/*
 * Editing in steps (design "one way, any number"; side bar 18 Nov): one window, the steps listed on the left like a
 * settings window — an icon and a name each, the one you are on lit, a tick when done, a count of changes in an
 * edit — and the step's fields beside it. The side bar runs to the bottom; the buttons sit under the fields only.
 * On a phone the side bar is a thin bar with the step's name, "2 of 4" and what comes next.
 */

export interface StepInfo<K extends string> {
  key: K;
  label: string;
  /** What the step holds now, in a few words ("FOB Ningbo · 50 days"). */
  summary?: string;
  /** Filled in (a tick on the right). */
  done?: boolean;
  /** Its icon in the side bar (a number when none). */
  icon?: ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
  /** Changes made on it, in an edit (a small count on the right). */
  count?: number;
  /** Set apart from the steps above by a thin line (Review, Changes). */
  apart?: boolean;
}

export function StepsFrame<K extends string>({
  steps,
  at,
  onGo,
  heading,
  children,
  footer,
  single = false,
  fill = false,
}: {
  /** One part on its own (Edit on that part, design 17 Nov): no rail and no bar, only its fields and the buttons. */
  single?: boolean;
  /**
   * The step's fields fill the window and do not scroll as a whole (a long list scrolls inside itself, its tools
   * and column names staying on top). Laptop only: on a phone the step scrolls as usual.
   */
  fill?: boolean;
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
  // Another step: it starts at its top, and the cursor goes to its title, so a screen reader says where it is
  // ("Delivery, step 2 of 4") and Tab goes on into its fields (not on the first step shown).
  const head = useRef<HTMLHeadingElement>(null);
  const shown = useRef(at);
  useEffect(() => {
    if (shown.current === at) return;
    shown.current = at;
    head.current?.closest("[data-step-body]")?.scrollTo?.({ top: 0 });
    head.current?.focus({ preventScroll: true });
  }, [at]);
  // "All steps" from one part: its button is gone, so the cursor goes to the step's title (Escape still closes).
  const wasSingle = useRef(single);
  useEffect(() => {
    if (wasSingle.current && !single) head.current?.focus({ preventScroll: true });
    wasSingle.current = single;
  }, [single]);
  const body = cn(
    "flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto px-6 pt-5 pb-6 max-md:px-4",
    // A short window: the step scrolls as a whole rather than squeezing the list to nothing (it keeps its least height).
    fill ? "max-md:*:shrink-0 md:overflow-y-auto md:pb-4" : "*:shrink-0",
  );
  if (single)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div data-step-body className={cn(body, "flex-1")}>
          {heading && <div className="flex justify-end">{heading}</div>}
          {children}
        </div>
        {footer}
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Phone: a thin bar of the steps, the step's name with where it is, and what comes next (a screen reader
          hears the same from the step's title). */}
      <div aria-hidden className="kb-tight border-b border-line px-4 pt-2.5 pb-3 md:hidden">
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
          {next && <span className="kb-hide truncate text-xs text-text-2">Next: {next.label}</span>}
        </p>
      </div>
      {/* The side bar stays put and runs to the bottom; only the step's own fields scroll (asked 17 Nov). */}
      <div className={cn("grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] md:min-h-[min(520px,calc(100dvh-12rem))]", RULES.stepsRail)}>
        <nav aria-label="Steps" className="min-h-0 overflow-y-auto border-r border-line bg-surface px-2.5 py-3 max-md:hidden md:row-span-2">
          <ol className="flex flex-col gap-0.5">
            {steps.map((s, k) => {
              const on = s.key === at;
              const Icon = s.icon;
              return (
                <li key={s.key}>
                  {s.apart && <hr aria-hidden className="mx-2.5 my-2 border-line" />}
                  <button
                    type="button"
                    onClick={() => onGo(s.key)}
                    aria-current={on ? "step" : undefined}
                    className={cn(
                      "flex h-[38px] w-full items-center gap-3 rounded-[9px] px-2.5 text-left text-sm font-medium text-text hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text",
                      on && "bg-surface-2 font-semibold hover:bg-surface-2",
                    )}
                  >
                    {Icon ? (
                      <Icon aria-hidden strokeWidth={1.8} className={cn("size-[18px] shrink-0", on ? "text-text" : "text-text-2")} />
                    ) : (
                      <span aria-hidden className="grid size-[18px] shrink-0 place-items-center text-xs font-semibold text-text-2 tabular">
                        {k + 1}
                      </span>
                    )}
                    <span className="sr-only">
                      Step {k + 1} of {steps.length}:{" "}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {s.count ? (
                      <span aria-hidden className="min-w-5 rounded-full bg-action-soft px-1.5 text-center text-xs leading-5 font-bold text-action">
                        {s.count}
                      </span>
                    ) : s.done && !on ? (
                      <Check aria-hidden strokeWidth={2.6} className="size-4 shrink-0 text-ok" />
                    ) : null}
                    <span className="sr-only">
                      {on ? ", current" : ""}
                      {s.count ? `, ${s.count} change${s.count === 1 ? "" : "s"}` : s.done ? ", done" : ""}
                      {s.summary ? `: ${s.summary}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div data-step-body className={body}>
          {/* On a phone the bar above says the step: its heading is for screen readers only, and takes no room. */}
          <div className={cn("flex min-h-7 items-center gap-3", !heading && "max-md:contents")}>
            <h3 ref={head} tabIndex={-1} aria-label={`${current.label}, step ${i + 1} of ${steps.length}`} className="text-lg leading-7 font-bold outline-none max-md:sr-only">
              {current.label}
            </h3>
            {heading && <span className="ml-auto">{heading}</span>}
          </div>
          {children}
        </div>
        <div className="min-w-0 md:col-start-2">{footer}</div>
      </div>
    </div>
  );
}

/**
 * The one footer of a steps window (design rules 18 Nov; canvas row "Cancel, not ✕"): one strong button only.
 * Left: ‹ Back (or, on the first step, a quiet note such as "Last changed 3 Nov"). Right: Cancel, then on a step a
 * quiet jump (Review, Changes · 3) and Next; on the last step — or a part on its own — the save. Next and the save are
 * the window's one blue button (primary, as in every other window: live audit 20 Nov), never two at once.
 * On a phone the items' total is a line of its own above the buttons, and the buttons share the width.
 *
 * - `onBack`: none on the first step. `backLabel`: "Back to search" in place of "Back".
 * - `jump`: the quiet button before Next ({ label, onClick }); not on a phone.
 * - `onNext`: none on the last step.
 * - `save`: the last step's strong button. Without `onClick` it submits the form (pending: `pendingText`);
 *   `also` is a quieter save beside it ("Save and add another").
 */
export function StepsFooter({
  onBack,
  backLabel = "Back",
  start,
  cancel = true,
  onCancel,
  jump,
  onNext,
  nextLabel = "Next",
  save,
}: {
  onBack?: (() => void) | null;
  backLabel?: string;
  start?: ReactNode;
  /** Cancel beside the buttons (false: the footer already says how to go back). */
  cancel?: boolean;
  onCancel?: () => void;
  /** Without `onClick`, the jump saves (submits the form): a quiet Save before the last step. */
  jump?: { label: ReactNode; onClick?: () => void } | null;
  onNext?: (() => void) | null;
  /** Next's word: "Review" when the next step is the review (so the way to it is always there). */
  nextLabel?: string;
  save: { label: ReactNode; disabled?: boolean; pendingText?: string; onClick?: () => void; busy?: boolean; also?: ReactNode };
}) {
  const last = !onNext;
  return (
    <div
      data-window-footer=""
      className={cn(RULES.window.inset, "sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:flex-wrap")}
    >
      <FooterTotal line />
      {onBack ? (
        <Button type="button" variant="ghost" data-back="" aria-label={backLabel} onClick={onBack} className={cn(backLabel === "Back" && "max-md:aspect-square max-md:px-0")}>
          <ChevronLeft aria-hidden /> <span className={cn(backLabel === "Back" && "max-md:hidden")}>{backLabel}</span>
        </Button>
      ) : (
        start && <span className="text-xs text-text-2 max-md:hidden">{start}</span>
      )}
      <span className="flex-1 max-md:hidden" />
      {cancel && <WindowCancel onClick={onCancel} className="max-md:flex-1" />}
      {last ? (
        <>
          {save.also}
          {save.onClick ? (
            <Button type="button" variant="primary" disabled={save.disabled || save.busy} aria-busy={save.busy} onClick={save.onClick} className="max-md:flex-1">
              <Check aria-hidden /> {save.label}
            </Button>
          ) : (
            <SubmitButton variant="primary" pendingText={save.pendingText ?? "Saving…"} disabled={save.disabled} className="max-md:flex-1">
              <Check aria-hidden /> {save.label}
            </SubmitButton>
          )}
        </>
      ) : (
        <>
          {jump &&
            (jump.onClick ? (
              <Button type="button" variant="ghost" onClick={jump.onClick} className="max-md:hidden">
                {jump.label}
              </Button>
            ) : (
              <SubmitButton variant="ghost" pendingText="Saving…" className="max-md:hidden">
                {jump.label}
              </SubmitButton>
            ))}
          <Button type="button" variant="primary" onClick={onNext!} className="max-md:flex-1">
            {nextLabel} <ChevronRight aria-hidden />
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * A refused field on another step: every steps window goes to the step that holds it, once per answer (a later
 * step change by hand is not undone). `stepOf` names the step of an error's field key.
 */
export function JumpToStep<K extends string>({ errors, stepOf, onJump }: { errors?: Record<string, string[] | undefined>; stepOf: (field: string) => K; onJump: (step: K) => void }) {
  const jump = useRef(onJump);
  const where = useRef(stepOf);
  useEffect(() => {
    jump.current = onJump;
    where.current = stepOf;
  });
  useEffect(() => {
    const first = Object.keys(errors ?? {}).find((k) => errors?.[k]?.length);
    if (first) jump.current(where.current(first));
  }, [errors]);
  return null;
}
