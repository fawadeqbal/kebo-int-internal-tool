"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, Circle, CircleDot, CircleDashed } from "lucide-react";
import { cn } from "@kebo/ui";
import type { Checkpoint, CheckState, StageProgress } from "./progress";

const ICON: Record<CheckState, typeof Circle> = { done: CheckCircle2, now: CircleDot, late: AlertCircle, missed: CircleDashed, todo: Circle };
const TONE: Record<CheckState, string> = {
  done: "text-ok",
  now: "text-primary",
  late: "text-bad",
  missed: "text-warn",
  todo: "text-muted",
};
const SR: Record<CheckState, string> = { done: "done", now: "to do now", late: "late", missed: "not recorded", todo: "still to come" };

/** Where the order is: the current stage, or the last one once all are done. */
const currentOf = (stages: StageProgress[]) => {
  const at = stages.findIndex((s) => s.state === "current");
  return at >= 0 ? at : stages.every((s) => s.state === "done") ? stages.length - 1 : 0;
};

function CheckpointRow({ c, base }: { c: Checkpoint; base: string }) {
  const Icon = ICON[c.state];
  return (
    <li>
      <Link href={c.tab ? `${base}/${c.tab}` : base} className="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[c.state])} aria-hidden />
        <span className="min-w-0">
          <span className={cn("block", c.state === "todo" ? "text-text-2" : c.state === "late" ? "font-medium text-bad" : c.state === "now" ? "font-medium text-primary" : "")}>
            {c.label}
            <span className="sr-only"> ({SR[c.state]})</span>
          </span>
          {(c.detail || c.state === "missed") && (
            <span className={cn("block text-xs", c.state === "missed" ? "text-warn" : "text-muted")}>{c.state === "missed" && !c.detail ? "not recorded" : c.detail}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Where the order is, shown once (on Overview): the four steps (click one to
 * see its checks), what is needed now with its buttons, and the checks of
 * the step. Each check links to the tab where it is done.
 */
export function OrderProgressCard({ stages, base, next, finished }: { stages: StageProgress[]; base: string; next: ReactNode; finished: boolean }) {
  const current = currentOf(stages);
  const [picked, setPicked] = useState(current);
  const shown = stages[picked]!;
  return (
    <section aria-label="Where the order is" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="px-4 py-3">
        <ol aria-label="Order steps" className="grid grid-cols-4 gap-1 sm:flex sm:items-center sm:gap-3">
          {stages.map((s, i) => (
            <li key={s.stage} className={cn("flex min-w-0 items-center gap-3", i < stages.length - 1 && "sm:flex-1")}>
              <button
                type="button"
                onClick={() => setPicked(i)}
                aria-pressed={i === picked}
                aria-current={s.state === "current" ? "step" : undefined}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1 text-center sm:flex-row sm:gap-2 sm:px-1.5 sm:text-left",
                  i === picked && i !== current && "bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    s.state === "done" ? "bg-ok text-white" : s.state === "current" ? "bg-primary text-primary-fg" : "border-[1.5px] border-line-strong text-muted",
                  )}
                >
                  {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className={cn("max-w-full truncate text-[11px] sm:text-sm", s.state === "current" ? "font-semibold text-primary" : s.state === "done" ? "text-text" : "text-text-2")}>
                  {s.label}
                  <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "current" ? "current" : "to come"})</span>
                </span>
                {s.state === "current" && <span className="hidden truncate text-xs text-muted xl:inline">{s.summary}</span>}
              </button>
              {i < stages.length - 1 && <span aria-hidden className={cn("hidden h-0.5 min-w-4 flex-1 rounded-full sm:block", s.state === "done" ? "bg-ok" : "bg-line")} />}
            </li>
          ))}
        </ol>
      </div>
      {finished ? (
        <p className="flex items-center gap-2 border-t border-ok/25 bg-ok-soft px-4 py-3 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
          <span className="font-medium">Done: paid in full and closed.</span>
        </p>
      ) : (
        next
      )}
      <div className="border-t border-line px-4 py-3">
        <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
          {picked === current ? (stages.every((s) => s.state === "done") ? "Every step" : "To finish this step") : `Step ${picked + 1}: ${shown.label}`}
        </p>
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {shown.checkpoints.map((c) => (
            <CheckpointRow key={c.key} c={c} base={base} />
          ))}
        </ul>
      </div>
    </section>
  );
}
