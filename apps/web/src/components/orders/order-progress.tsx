"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, Circle, CircleDot, CircleDashed } from "lucide-react";
import { Card, CardBody, CardHeader, cn } from "@kebo/ui";
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

/**
 * The order's four stages on one line: done ones ticked, the current one
 * filled with how many of its checks are done. On a phone: "Step 1 of 4 ·
 * Confirmed" over a four-part bar.
 */
export function OrderStepper({ stages }: { stages: StageProgress[] }) {
  const current = currentOf(stages);
  const cur = stages[current]!;
  const allDone = stages.every((s) => s.state === "done");
  return (
    <div aria-label="Order stages" role="group">
      {/* Phone */}
      <div className="flex flex-col gap-2 sm:hidden">
        <p className="flex items-baseline justify-between gap-2 text-sm">
          <span className={cn("font-medium", allDone ? "text-ok" : "text-primary")}>
            {allDone ? "All steps done" : `Step ${current + 1} of ${stages.length} · ${cur.label}`}
          </span>
          {!allDone && stages[current + 1] && <span className="truncate text-xs text-muted">next: {stages[current + 1]!.label}</span>}
        </p>
        <span className="grid grid-cols-4 gap-1" aria-hidden>
          {stages.map((s) => (
            <span key={s.stage} className={cn("h-1 rounded-full", s.state === "done" ? "bg-ok" : s.state === "current" ? "bg-primary" : "bg-surface-3")} />
          ))}
        </span>
      </div>
      {/* Wider screens */}
      <ol className="hidden items-center gap-3 sm:flex">
        {stages.map((s, i) => (
          <li key={s.stage} className={cn("flex min-w-0 items-center gap-3", i < stages.length - 1 && "flex-1")}>
            <span className="flex min-w-0 items-center gap-2" aria-current={s.state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  s.state === "done" ? "bg-ok text-white" : s.state === "current" ? "bg-primary text-primary-fg" : "border-[1.5px] border-line-strong text-muted",
                )}
              >
                {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", s.state === "current" ? "shrink-0 font-semibold text-primary" : cn("truncate", s.state === "done" ? "text-text" : "text-text-2"))}>
                {s.label}
                <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "current" ? "current" : "to come"})</span>
              </span>
              {s.state === "current" && <span className="hidden truncate text-xs text-muted xl:inline">{s.summary}</span>}
            </span>
            {i < stages.length - 1 && <span aria-hidden className={cn("h-0.5 min-w-4 flex-1 rounded-full", s.state === "done" ? "bg-ok" : "bg-line")} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

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
 * The checks of a stage, the current one first; the other stages' checks one
 * click away. Each check links to the tab where it is done.
 */
export function StageChecklist({ stages, base }: { stages: StageProgress[]; base: string }) {
  const current = currentOf(stages);
  const [picked, setPicked] = useState(current);
  const shown = stages[picked]!;
  return (
    <Card>
      <CardHeader title={picked === current ? `This step: ${shown.label}` : `Step ${picked + 1}: ${shown.label}`} description={shown.summary} />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show the checks of">
          {stages.map((s, i) => (
            <button
              key={s.stage}
              type="button"
              onClick={() => setPicked(i)}
              aria-pressed={i === picked}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium",
                i === picked ? "border-primary bg-primary-soft text-primary" : "border-line text-text-2 hover:bg-surface-2",
              )}
            >
              {s.state === "done" && <Check className="size-3" aria-hidden />}
              {i + 1}. {s.label}
            </button>
          ))}
        </div>
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {shown.checkpoints.map((c) => (
            <CheckpointRow key={c.key} c={c} base={base} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
