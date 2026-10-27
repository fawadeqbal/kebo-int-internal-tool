"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronDown, Circle, CircleDot, CircleDashed } from "lucide-react";
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
const BAR: Record<CheckState, string> = { done: "bg-ok", now: "bg-primary", late: "bg-bad", missed: "bg-warn", todo: "bg-surface-3" };
const SR: Record<CheckState, string> = { done: "done", now: "to do now", late: "late", missed: "not recorded", todo: "still to come" };

function CheckpointCard({ c, base }: { c: Checkpoint; base: string }) {
  const Icon = ICON[c.state];
  return (
    <li className="min-w-0">
      <Link
        href={c.tab ? `${base}/${c.tab}` : base}
        className={cn(
          "flex h-full items-start gap-2 rounded-lg border bg-surface px-2.5 py-2 text-sm transition-colors hover:border-line-strong",
          c.state === "late" ? "border-bad/40" : c.state === "now" ? "border-primary/40" : "border-line",
        )}
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[c.state])} aria-hidden />
        <span className="min-w-0">
          <span className={cn("block leading-tight", c.state === "todo" ? "text-text-2" : c.state === "late" ? "font-medium text-bad" : c.state === "now" ? "font-medium" : "")}>
            {c.label}
            <span className="sr-only"> ({SR[c.state]})</span>
          </span>
          {(c.detail || c.state === "missed") && (
            <span className={cn("block truncate text-xs", c.state === "missed" ? "text-warn" : "text-muted")}>
              {c.state === "missed" && !c.detail ? "not recorded" : c.detail}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * The order's four stages as cards, each with a small bar per checkpoint;
 * the current stage's checkpoints are open below, and any other stage's open
 * on a click. On a phone the stages fold into one line that opens a list.
 */
export function OrderProgress({ stages, base }: { stages: StageProgress[]; base: string }) {
  const at = stages.findIndex((s) => s.state === "current");
  const current = at >= 0 ? at : stages.every((s) => s.state === "done") ? stages.length - 1 : 0;
  const [picked, setPicked] = useState(current);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const shown = stages[picked]!;
  const cur = stages[current]!;
  const step = `Step ${current + 1} of ${stages.length}`;

  return (
    <section aria-label="Order progress" className="flex flex-col gap-2">
      {/* Phone: one line, opens every checkpoint as a list. */}
      <div className="sm:hidden">
        <button
          type="button"
          onClick={() => setPhoneOpen((v) => !v)}
          aria-expanded={phoneOpen}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm"
        >
          <span>
            <span className="font-medium">{step} · {cur.label}</span>
            <span className="block text-xs text-muted">{cur.summary}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", phoneOpen && "rotate-180")} aria-hidden />
        </button>
        {phoneOpen && (
          <div className="mt-2 flex flex-col gap-3">
            {stages.map((s) => (
              <div key={s.stage}>
                <p className={cn("mb-1 text-xs font-semibold tracking-wide uppercase", s.state === "current" ? "text-primary" : s.state === "done" ? "text-ok" : "text-muted")}>
                  {s.label} <span className="font-normal normal-case">· {s.summary}</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {s.checkpoints.map((c) => (
                    <CheckpointCard key={c.key} c={c} base={base} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wider screens: four stage cards, the chosen one's checkpoints below. */}
      <div className="hidden sm:flex sm:flex-col sm:gap-2">
        <div role="tablist" aria-label="Order stages" className="grid grid-cols-4 gap-2">
          {stages.map((s, i) => (
            <button
              key={s.stage}
              type="button"
              role="tab"
              aria-selected={i === picked}
              aria-controls="order-checkpoints"
              onClick={() => setPicked(i)}
              className={cn(
                "min-w-0 rounded-lg border bg-surface px-3 py-2 text-left transition-colors hover:border-line-strong",
                i === picked ? "border-primary ring-1 ring-primary/30" : "border-line",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-sm font-medium",
                  s.state === "done" ? "text-ok" : s.state === "current" ? "text-primary" : "text-text-2",
                )}
              >
                {s.state === "done" && <CheckCircle2 className="size-4" aria-hidden />}
                <span className="truncate">
                  {i + 1}. {s.label}
                </span>
              </span>
              <span className="block truncate text-xs text-muted">{s.summary}</span>
              <span className="mt-1.5 flex gap-1" aria-hidden>
                {s.checkpoints.map((c) => (
                  <span key={c.key} className={cn("h-1 flex-1 rounded-full", BAR[c.state])} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <ul id="order-checkpoints" role="tabpanel" aria-label={`${shown.label}: checkpoints`} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {shown.checkpoints.map((c) => (
            <CheckpointCard key={c.key} c={c} base={base} />
          ))}
        </ul>
      </div>
    </section>
  );
}
