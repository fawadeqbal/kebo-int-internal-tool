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
                      "flex h-[38px] w-full items-center gap-3 rounded-[9px] px-2.5 text-left text-[14.5px] font-medium text-text hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text",
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
            <h3 ref={head} tabIndex={-1} aria-label={`${current.label}, step ${i + 1} of ${steps.length}`} className="text-[17px] leading-7 font-bold outline-none max-md:sr-only">
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
  /** Cancel's own way to close (by default it closes the window, asking first when something changed). */
  onCancel?: () => void;
}) {
  return (
    // Canvas row "Cancel, not ✕": ‹ (back one step) · Cancel · Next — Next the strong one, Save on the last step; on a
    // laptop Back on the left, Cancel beside the saves. On a phone a step's own Save waits for the last step.
    <div
      data-window-footer=""
      className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface px-6 py-3 max-md:px-4 max-sm:flex-wrap max-md:[&>button]:min-h-12 max-md:[&>button:not([data-back])]:flex-1"
    >
      {/* A phone: the items' total on its own line above the buttons (design "Items on a small phone"). */}
      <FooterTotal line />
      {!first && (
        <Button type="button" variant="secondary" data-back="" aria-label="Back" onClick={onBack} className="max-md:size-12 max-md:px-0">
          <ChevronLeft aria-hidden /> <span className="max-md:hidden">Back</span>
        </Button>
      )}
      <span className="flex-1 max-md:hidden" />
      <WindowCancel onClick={onCancel} />
      <SubmitButton variant={last ? "primary" : "secondary"} pendingText="Saving…" disabled={!canSave} className={cn(!last && "max-md:hidden")}>
        {saveLabel}
      </SubmitButton>
      {!last && (
        <Button type="button" variant="primary" onClick={onNext}>
          Next <ChevronRight aria-hidden className="max-md:hidden" />
        </Button>
      )}
    </div>
  );
}

/**
 * The buttons of one part on its own: Cancel and Save on the right (no "All steps": a part's window is that part;
 * Edit all in ⋯ has every step). On a phone the items' total sits beside Save.
 */
export function OnePartFooter({
  onCancel,
  canSave = true,
  saveLabel = "Save",
}: {
  onCancel?: () => void;
  canSave?: boolean;
  saveLabel?: string;
}) {
  return (
    // Canvas row "Cancel, not ✕": Cancel · Save, each half the width on a phone.
    <div data-window-footer="" className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface px-6 py-3 max-md:flex-wrap max-md:px-4 max-md:[&>button]:min-h-12 max-md:[&>button]:flex-1">
      {/* A phone: the items' total on its own line, then Cancel · Save (canvas board "Items windows"). */}
      <FooterTotal line />
      <span className="flex-1 max-md:hidden" />
      <WindowCancel onClick={onCancel} />
      <SubmitButton variant="primary" pendingText="Saving…" disabled={!canSave}>
        <Check aria-hidden /> {saveLabel}
      </SubmitButton>
    </div>
  );
}
