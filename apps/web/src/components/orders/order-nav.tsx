"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { isPaperKind, PAPER_STEP, STEP_PATH, type FlowStep, type ProgressState } from "@kebo/shared";
import { buttonClass, cn } from "@kebo/ui";

export interface NavStep {
  key: FlowStep;
  number: number;
  label: string;
  state: ProgressState;
  /** The fact under the name: a date, an amount, or what it waits for. */
  fact: string;
  href: string;
}

/** Pages that belong to a step (their own address, the step's place in the line). */
const INSIDE: Record<string, FlowStep> = { goods: "production", packing: "shipping" };
const SHORT: Partial<Record<FlowStep, string>> = { factory: "Factory", documents: "Papers", delivery: "Delivery" };

/** The step's round mark: a tick when done (a ring when only part), its number otherwise (filled when now or late). */
export function ProgressMark({ state, number }: { state: ProgressState; number: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full text-[10.5px] font-bold tabular",
        state === "done" && "bg-primary-solid text-primary-fg",
        state === "part" && "border-[1.5px] border-primary-solid text-primary",
        state === "now" && "bg-action-solid text-white",
        state === "late" && "bg-bad text-white",
        state === "wait" && "border-[1.5px] border-line-strong text-text-2",
      )}
    >
      {state === "done" || state === "part" ? <Check className="size-3" strokeWidth={3.4} /> : number}
    </span>
  );
}

const STATE_WORD: Record<ProgressState, string> = { done: "done", part: "part done", now: "now", late: "late", wait: "waiting" };

/** The address the line reads: a paper's Make page and the pages inside a step count as that step. */
function useOrderPath(base: string) {
  const at = usePathname();
  const rest = at.slice(base.length);
  const paper = rest.match(/^\/papers\/([a-z-]+)/)?.[1];
  if (paper && isPaperKind(paper)) return `${base}/${STEP_PATH[PAPER_STEP[paper]]}`;
  const inside = INSIDE[rest.split("/")[1] ?? ""];
  return inside ? `${base}/${STEP_PATH[inside]}` : at;
}

/**
 * The order's one line (design "Order flow, redesigned"): Overview, then the
 * steps — each its mark, its name and one fact under it — and, at the end, the
 * quiet pages of the whole order. It is the progress and the navigation; there
 * is no second row of tabs. On a phone: the steps as six marks, the other
 * pages in one quiet row above them.
 */
export function OrderNav({ base, steps, pages }: { base: string; steps: NavStep[]; pages: { href: string; label: string }[] }) {
  const path = useOrderPath(base);
  const under = (href: string) => (href === base ? path === base : path === href || path.startsWith(`${href}/`));
  const quiet = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      aria-current={under(href) ? "page" : undefined}
      className="-mb-px flex h-11 shrink-0 items-center border-b-2 border-transparent text-[13px] text-text-2 hover:text-text aria-[current]:border-primary-solid aria-[current]:font-semibold aria-[current]:text-text md:h-[50px]"
    >
      {label}
    </Link>
  );
  return (
    <div className="no-print mt-4 flex flex-col">
      {/* Phone: the whole order's pages in one quiet row. */}
      <nav aria-label="The whole order" className="flex gap-5 overflow-x-auto border-b border-line [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {quiet(base, "Overview")}
        {pages.map((p) => quiet(p.href, p.label))}
      </nav>
      <nav aria-label="Order steps" className="grid auto-cols-fr grid-flow-col border-b border-line lg:hidden">
        {steps.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            aria-current={under(s.href) ? "page" : undefined}
            aria-label={`${s.label}: ${STATE_WORD[s.state]}`}
            className={cn(
              "-mb-px flex min-h-14 flex-col items-center justify-center gap-1 border-b-2 border-transparent text-[10px] text-text aria-[current]:border-primary-solid aria-[current]:font-bold",
              (s.state === "now" || s.state === "late") && "font-bold",
            )}
          >
            <ProgressMark state={s.state} number={s.number} />
            <span className="max-w-full truncate px-0.5">{SHORT[s.key] ?? s.label}</span>
          </Link>
        ))}
      </nav>

      {/* A laptop and up: one line. The steps share the room and shorten; the quiet pages keep theirs. */}
      <nav aria-label="Order" className="flex items-stretch border-b border-line max-lg:hidden">
        <Link
          href={base}
          aria-current={under(base) ? "page" : undefined}
          className="-mb-px mr-3 flex h-[50px] shrink-0 items-center border-b-2 border-transparent pr-4 pl-0.5 text-[13px] font-medium text-text aria-[current]:border-primary-solid aria-[current]:font-bold"
        >
          Overview
        </Link>
        <span className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-x-2">
          {steps.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              aria-current={under(s.href) ? "page" : undefined}
              title={`${s.label}: ${STATE_WORD[s.state]}${s.fact ? ` · ${s.fact}` : ""}`}
              className="-mb-px flex h-[50px] min-w-0 items-center gap-2 border-b-2 border-transparent px-0.5 text-[13px] text-text aria-[current]:border-primary-solid"
            >
              <ProgressMark state={s.state} number={s.number} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className={cn("truncate font-medium", (s.state === "now" || s.state === "late" || under(s.href)) && "font-bold")}>{s.label}</span>
                <span className={cn("truncate text-[11.5px] max-xl:hidden", s.state === "late" ? "text-bad" : "text-text-2")}>{s.fact}</span>
              </span>
            </Link>
          ))}
        </span>
        <span className="flex shrink-0 items-center gap-[18px] pl-5">{pages.map((p) => quiet(p.href, p.label))}</span>
      </nav>
    </div>
  );
}

/**
 * "Do next", on top of every page of the order: the first thing that can be
 * done today (late first), when it is due and who has it, and the way to it.
 * On that step's own page the to-do list right under it has the button.
 */
export function DoNext({
  base,
  title,
  meta,
  late,
  step,
  stepLabel,
}: {
  base: string;
  title: string;
  meta: string;
  late: boolean;
  step: FlowStep;
  stepLabel: string;
}) {
  const path = useOrderPath(base);
  const href = `${base}/${STEP_PATH[step]}`;
  const here = path === href;
  return (
    <section aria-label="Do next" className="no-print mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <span className={cn("text-xs font-semibold", late ? "text-bad" : "text-action")}>Do next</span>
        <span className="text-[17px] leading-snug font-bold">{title}</span>
        <span className="text-[13px] text-text-2">{meta}</span>
      </div>
      {here ? (
        <a href="#todo" className={buttonClass("secondary", "md")}>
          See it in the list below
        </a>
      ) : (
        <Link href={`${href}#todo`} className={buttonClass("primary", "md", "max-sm:w-full")}>
          Open {stepLabel} <ArrowRight aria-hidden />
        </Link>
      )}
    </section>
  );
}
