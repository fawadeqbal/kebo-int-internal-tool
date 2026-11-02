"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { isPaperKind, PAPER_STEP, STEP_PATH, type StepState } from "@kebo/shared";
import { cn } from "@kebo/ui";

export interface StepNavStep {
  key: string;
  number: number;
  label: string;
  state: StepState;
  done: number;
  total: number;
  href: string;
}

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
          ? "border-primary bg-primary text-primary-fg"
          : state === "late"
            ? "border-bad bg-bad text-white"
            : "border-line-strong bg-surface text-muted",
      )}
    >
      {number}
    </span>
  );
}

const SR: Record<StepState, string> = { done: "done", now: "now", late: "late", todo: "later" };

/**
 * The order's navigation: Overview, the steps (tick or number, and n/m done)
 * and History. A row of links from a tablet up; on a phone, "Step 3 of 6 ▾"
 * opens the same links.
 */
export function StepNav({ base, steps }: { base: string; steps: StepNavStep[] }) {
  const at = usePathname();
  // A paper's Make page (/orders/:id/papers/:kind) belongs to the paper's step.
  const paper = at.slice(base.length).match(/^\/papers\/([a-z-]+)/)?.[1];
  const path = paper && isPaperKind(paper) ? `${base}/${STEP_PATH[PAPER_STEP[paper]]}` : at;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const links = [{ href: base, label: "Overview" }, ...steps, { href: `${base}/history`, label: "History" }];
  const active = (href: string) => (href === base ? path === base : path === href || path.startsWith(`${href}/`));
  const here = steps.find((s) => active(s.href));
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
      <nav aria-label="Order steps" className="no-print mt-4 hidden border-b border-line md:block">
        <ul className="-mb-px flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((l) => {
            const s = "number" in l ? l : null;
            const on = active(l.href);
            return (
              <li key={l.href} className="shrink-0">
                <Link
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm whitespace-nowrap transition-colors",
                    on ? "border-primary font-semibold text-text" : "border-transparent text-text-2 hover:text-text",
                  )}
                >
                  {s && <StepMark state={s.state} number={s.number} />}
                  <span>{l.label}</span>
                  {s && (
                    <span className={cn("text-[11px] tabular", s.state === "late" ? "text-bad" : "text-muted")}>
                      {s.done}/{s.total}
                      <span className="sr-only"> done, {SR[s.state]}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

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
              {here ? `Step ${here.number} of ${steps.length}` : active(base) ? "Overview" : "History"}
              {!here && current ? ` · now step ${current.number}` : ""}
            </span>
            <span className="block truncate text-sm font-semibold">
              {here ? `${here.label} · ${here.done} of ${here.total}` : active(base) ? "The order at a glance" : "Every change"}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="flex gap-1" aria-hidden>
              {steps.map((s) => (
                <span
                  key={s.key}
                  className={cn(
                    "size-2 rounded-full",
                    s.state === "done" ? "bg-ok" : s.state === "now" ? "bg-primary" : s.state === "late" ? "bg-bad" : "bg-line-strong",
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
                    {s && (
                      <span className={cn("text-xs tabular", s.state === "late" ? "text-bad" : "text-muted")}>
                        {s.done}/{s.total}
                      </span>
                    )}
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
