"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { isPaperKind, PAPER_STEP, STEP_PATH, type StepState } from "@kebo/shared";
import { cn, SectionNav, StageBar } from "@kebo/ui";

export interface StepNavStep {
  key: string;
  number: number;
  label: string;
  state: StepState;
  /** "n/m done" beside the step (the order); or `status` instead ("3 offers", "R2 draft": the inquiry). */
  done?: number;
  total?: number;
  status?: string;
  href: string;
}

/** What the bar shows beside a step: its short status, or n/m done. */
const tagOf = (s: StepNavStep) => s.status ?? (s.total !== undefined ? `${s.done ?? 0}/${s.total}` : "");

/** The step's round mark: a tick when done, its number (filled when it is the one now). */
export function StepMark({ state, number, size = "sm" }: { state: StepState; number: number; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-[18px] text-[10px]" : "size-6 text-xs";
  if (state === "done")
    return (
      <span className={cn("grid shrink-0 place-items-center rounded-full bg-ok text-white", box)} aria-hidden>
        <Check className={size === "sm" ? "size-3" : "size-3.5"} strokeWidth={3} />
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-[1.5px] font-bold tabular",
        box,
        state === "now"
          ? "border-action-solid bg-action-solid text-white"
          : state === "late"
            ? "border-bad bg-bad text-white"
            : "border-line-strong bg-surface text-muted",
      )}
    >
      {number}
    </span>
  );
}

const WORD: Record<StepState, string> = { done: "Done", now: "Now", late: "Late", todo: "Later" };

/**
 * The flow's steps as boxes (Kebo ERP look), from a tablet up: done soft green with a tick, now an
 * orange edge, late a red edge, later plain; each box links to its step's page, the page you are on
 * ringed in green. The word ("Done", "Now"…) is written; the colour only repeats it.
 */
export function StepBoxes({ steps, label, isHere }: { steps: StepNavStep[]; label: string; isHere: (href: string) => boolean }) {
  return (
    <nav aria-label={label} className="no-print hidden md:block">
      <ol className="flex gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((s) => {
          const here = isHere(s.href);
          return (
            <li key={s.key} className="flex min-w-44 flex-1">
              <Link
                href={s.href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 transition-shadow hover:shadow-card",
                  s.state === "done" && "border border-primary-line bg-primary-soft",
                  s.state === "now" && "border-2 border-action-solid bg-action-soft",
                  s.state === "late" && "border-2 border-bad bg-bad-soft",
                  s.state === "todo" && "border border-line bg-surface",
                  here && "shadow-card",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-bold text-text">
                  {/* Board: a tick when done, a dot now (or late), else the step's number. */}
                  {s.state === "done" ? (
                    <Check className="size-3.5 shrink-0 text-ok" strokeWidth={3} aria-hidden />
                  ) : s.state === "now" || s.state === "late" ? (
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", s.state === "late" ? "bg-bad" : "bg-action-solid")} />
                  ) : (
                    <span aria-hidden className="font-semibold text-text-2 tabular">
                      {s.number}
                    </span>
                  )}
                  <span className="truncate">{s.label}</span>
                  <span className={cn("ml-auto text-[11px] font-semibold", s.state === "late" ? "text-bad" : s.state === "now" ? "text-action" : "text-muted")}>{WORD[s.state]}</span>
                </span>
                <span className={cn("truncate text-xs", s.state === "late" ? "font-medium text-bad" : "text-text-2")}>{tagOf(s) || "—"}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The order's (and the inquiry's) navigation: Overview, the steps (tick or
 * number, and n/m done or a short status), Costs (with what was spent, for
 * managers), History and any extra link ("Order →"). A row of links from a
 * tablet up; on a phone, "Step 3 of 6 ▾" opens the same links.
 */
export function StepNav({
  base,
  steps,
  costs,
  label = "Order steps",
  glance = "The order at a glance",
  extra = [],
  stages,
  files,
  icons,
}: {
  base: string;
  steps: StepNavStep[];
  costs?: { spent?: string } | null;
  /** The nav's name for screen readers. */
  label?: string;
  /** The phone picker's line for the overview. */
  glance?: string;
  /** Links after History (e.g. the inquiry's "Order →"). */
  extra?: { href: string; label: string }[];
  /** The record's stage as a bar above the chips (board: New → Sourcing → Quoted → Won). */
  stages?: { list: string[]; current: number };
  /** A Files page between Costs and History. */
  files?: boolean;
  /** Board inquiry tabs: an icon before each page (by its label) and the step's status as a grey pill, instead of numbers. */
  icons?: Record<string, ReactNode>;
}) {
  const at = usePathname();
  // A paper's Make page (/orders/:id/papers/:kind) belongs to the paper's step.
  const paper = at.slice(base.length).match(/^\/papers\/([a-z-]+)/)?.[1];
  const path = paper && isPaperKind(paper) ? `${base}/${STEP_PATH[PAPER_STEP[paper]]}` : at;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const links: ({ href: string; label: string; tag?: string } | StepNavStep)[] = [
    { href: base, label: "Overview" },
    ...steps,
    ...(costs ? [{ href: `${base}/costs`, label: "Costs", tag: costs.spent }] : []),
    ...(files ? [{ href: `${base}/files`, label: "Files" }] : []),
    { href: `${base}/history`, label: "History" },
    ...extra,
  ];
  const active = (href: string) => (href === base ? path === base : path === href || path.startsWith(`${href}/`));
  const here = steps.find((s) => active(s.href));
  const of = Math.max(steps.length, ...steps.map((s) => s.number));
  const current = steps.find((s) => s.state === "now" || s.state === "late");

  // A new page closes the picker (adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState(path);
  if (seen !== path) {
    setSeen(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <>
      {/* From a tablet up (board): the stage bar, then every page as chips, a step's chip with its mark and short status. */}
      <div className="mt-4 flex flex-col gap-3 max-md:hidden">
        {stages && <StageBar stages={stages.list} current={stages.current} label="Stage" />}
        <SectionNav
          label={label}
          phone="none"
          items={links.map((l) => {
            const s = "number" in l ? l : null;
            return {
              href: l.href,
              label: l.label,
              active: active(l.href),
              mark: icons ? icons[l.label] : s ? <StepMark state={s.state} number={s.number} /> : undefined,
              alert: s?.state === "late",
              count: icons ? undefined : s ? tagOf(s) || undefined : "tag" in l ? l.tag : undefined,
              tag: icons ? (s ? tagOf(s) || undefined : "tag" in l ? l.tag : undefined) : undefined,
            };
          })}
        />
      </div>

      <div ref={box} className="no-print relative mt-3 md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="order-steps-menu"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left shadow-card"
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted">
              {here ? `Step ${here.number} of ${of}` : active(base) ? "Overview" : active(`${base}/costs`) ? "Costs" : "History"}
              {!here && current ? ` · now step ${current.number}` : ""}
            </span>
            <span className="block truncate text-sm font-semibold">
              {here
                ? `${here.label}${here.status !== undefined ? (here.status ? ` · ${here.status}` : "") : here.total !== undefined ? ` · ${here.done ?? 0} of ${here.total}` : ""}`
                : active(base)
                  ? glance
                  : active(`${base}/costs`)
                    ? costs?.spent
                      ? `Spent ${costs.spent}`
                      : "What was spent"
                    : "Every change"}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="flex gap-1" aria-hidden>
              {steps.map((s) => (
                <span
                  key={s.key}
                  className={cn(
                    "size-2 rounded-full",
                    s.state === "done" ? "bg-ok" : s.state === "now" ? "bg-action-solid" : s.state === "late" ? "bg-bad" : "bg-line-strong",
                  )}
                />
              ))}
            </span>
            <ChevronDown className={cn("size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        </button>
        {open && (
          <ul
            id="order-steps-menu"
            className="absolute inset-x-0 top-full z-30 mt-1 flex flex-col overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop"
          >
            {links.map((l) => {
              const s = "number" in l ? l : null;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active(l.href) ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm",
                      active(l.href) ? "bg-primary-soft font-semibold text-primary" : "hover:bg-surface-2",
                    )}
                  >
                    {s ? <StepMark state={s.state} number={s.number} /> : <span className="size-[18px]" aria-hidden />}
                    <span className="flex-1">{l.label}</span>
                    {"tag" in l && l.tag && <span className="text-xs text-muted tabular">{l.tag}</span>}
                    {s && <span className={cn("text-xs tabular", s.state === "late" ? "text-bad" : "text-muted")}>{tagOf(s)}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
