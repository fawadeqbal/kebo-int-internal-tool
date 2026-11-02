import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, FileText, Plus } from "lucide-react";
import { FLOW_STEP_LABEL, STEP_PATH, type FlowStep, type StepState } from "@kebo/shared";
import { Badge, buttonClass, Card, CardHeader, cn } from "@kebo/ui";
import { date, dateTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import type { ChecklistItem, OrderSteps, StepView } from "@/lib/types-checklist";

/** Dates in a step's line ("Ordered 2026-11-08") as people read them. */
export const readable = (line: string) => line.replace(/\d{4}-\d{2}-\d{2}/g, (d) => date(d));

export const STATE_TONE: Record<StepState, "ok" | "primary" | "bad" | "neutral"> = {
  done: "ok",
  now: "primary",
  late: "bad",
  todo: "neutral",
};

export function StateBadge({ state, label }: { state: StepState; label: string }) {
  return (
    <Badge tone={STATE_TONE[state]} dot={state === "now" || state === "late"}>
      {label}
    </Badge>
  );
}

export function ProgressBar({ done, total, state, className }: { done: number; total: number; state: StepState; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} done`}
    >
      <div
        className={cn("h-full rounded-full", state === "done" ? "bg-ok" : state === "late" ? "bg-bad" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** The step's top: its number, name, state, n of m, one line on where it stands, progress, and its main button. */
function StepHeader({ step, action, line }: { step: StepView; action?: ReactNode; line?: string }) {
  return (
    <section
      aria-labelledby="step-title"
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:p-5"
    >
      <span
        aria-hidden
        className={cn(
          "hidden size-12 shrink-0 place-items-center rounded-xl text-lg font-bold sm:grid",
          step.state === "done"
            ? "bg-ok text-white"
            : step.state === "now"
              ? "bg-primary text-primary-fg"
              : step.state === "late"
                ? "bg-bad text-white"
                : "bg-surface-3 text-text-2",
        )}
      >
        {step.state === "done" ? <Check className="size-5" strokeWidth={3} /> : step.number}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="step-title" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-lg font-semibold">
          <span>
            <span className="sm:hidden">{step.number} · </span>
            {step.label}
          </span>
          <StateBadge state={step.state} label={step.stateLabel} />
          <span className="text-xs font-normal text-muted tabular">
            {step.done} of {step.total} done
          </span>
        </h2>
        {(line ?? step.line) && <p className="mt-0.5 text-sm text-text-2">{readable(line ?? step.line)}</p>}
        <ProgressBar done={step.done} total={step.total} state={step.state} className="mt-2.5 max-w-md" />
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 has-[form]:basis-full sm:has-[form]:basis-auto">{action}</div>}
    </section>
  );
}

/** ← previous step · next step → */
function PrevNext({ base, steps, here }: { base: string; steps: StepView[]; here: FlowStep }) {
  const at = steps.findIndex((s) => s.key === here);
  const prev =
    at > 0 ? { href: `${base}/${STEP_PATH[steps[at - 1]!.key]}`, label: steps[at - 1]!.label } : { href: base, label: "Overview" };
  const next =
    at < steps.length - 1
      ? { href: `${base}/${STEP_PATH[steps[at + 1]!.key]}`, label: steps[at + 1]!.label }
      : { href: `${base}/history`, label: "History" };
  return (
    <nav aria-label="Steps" className="no-print flex items-center justify-between gap-3 border-t border-line pt-4">
      <Link href={prev.href} className={buttonClass("ghost", "md", "px-2")}>
        <ArrowLeft aria-hidden /> {prev.label}
      </Link>
      <Link href={next.href} className={buttonClass("secondary", "md")}>
        {next.label} <ArrowRight aria-hidden />
      </Link>
    </nav>
  );
}

/**
 * Every step page (order v4): the header card, then the checklist and, under
 * "What this step holds", the step's read-only view on the left (details,
 * lines, papers and costs) and the side cards (files, changes) on the right,
 * then the way to the step before and after.
 */
export function StepPage({
  steps,
  step,
  base,
  action,
  line,
  side,
  children,
}: {
  steps: OrderSteps;
  step: FlowStep;
  base: string;
  action?: ReactNode;
  /** The step's one line, when the page says it better than the checklist (Documents: papers ready, what is missing, the bank). */
  line?: string;
  side: ReactNode;
  children: ReactNode;
}) {
  const view = steps.steps.find((s) => s.key === step);
  return (
    <div className="flex flex-col gap-5">
      {view ? (
        <StepHeader step={view} action={action} line={line} />
      ) : (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
          {FLOW_STEP_LABEL[step]} is switched off for your company.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
        <aside className="flex min-w-0 flex-col gap-5">{side}</aside>
      </div>
      <PrevNext base={base} steps={steps.steps} here={step} />
    </div>
  );
}

/** "What this step holds · view only, change with Edit": the line between the checklist and the step's view. */
export function StepViewDivider() {
  return (
    <div className="flex items-center gap-3 pt-1" role="separator" aria-label="What this step holds">
      <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">What this step holds</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
      <span className="text-xs text-muted">view only · change with Edit</span>
    </div>
  );
}

/** Papers and Costs side by side on a wide screen, one under the other below. */
export function ViewPair({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-5 lg:grid-cols-2 [&>*]:min-w-0">{children}</div>;
}

/** The files the step's items keep, and where to add more. */
export function StepFiles({ items, addHref }: { items: ChecklistItem[]; addHref?: string }) {
  const files = new Map<string, string>();
  for (const i of items) {
    if (i.file) files.set(i.file.id, i.file.name);
    for (const f of i.fields)
      if (f.type === "file" && i.values[f.key]) files.set(i.values[f.key]!, i.data.find(([l]) => l === f.label)?.[1] ?? "File");
  }
  return (
    <Card>
      <CardHeader title="Files" />
      <div className="flex flex-wrap gap-2 px-4 py-3.5">
        {[...files].map(([id, name]) => (
          <a
            key={id}
            href={`/files/${id}?view=1`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium hover:border-line-strong"
          >
            <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{name}</span>
          </a>
        ))}
        {!files.size && <p className="w-full text-xs text-muted">No files on this step yet.</p>}
        {addHref && (
          <Link
            href={addHref}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
          >
            <Plus className="size-3.5" aria-hidden /> Add files
          </Link>
        )}
      </div>
    </Card>
  );
}

/** Who changed what in this step, newest first (the few latest), and the way to the whole history. */
export function StepChanges({
  entries,
  historyHref,
  showStep,
  title,
}: {
  entries: (HistoryEntry & { step?: string | null })[];
  historyHref: string;
  showStep?: boolean;
  title?: string;
}) {
  return (
    <Card>
      <CardHeader
        title={title ?? (showStep ? "Recent changes" : "Changes in this step")}
        actions={
          <Link href={historyHref} className={buttonClass("ghost", "xs")}>
            {showStep ? "History" : "All history"}
          </Link>
        }
      />
      {entries.length ? (
        <ol className="flex flex-col divide-y divide-line px-4">
          {entries.map((e) => {
            // A summary that already says "a → b" needs no "was".
            const change = /→/.test(e.summary ?? "") ? null : e.changes.find((c) => c.from && c.to);
            return (
              <li key={e.id} className="flex gap-2.5 py-3">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary"
                >
                  {(e.by?.name ?? "S").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 text-xs leading-relaxed">
                  <span className="block text-text-2">
                    <span className="font-semibold text-text">{e.by?.name ?? "System"}</span>{" "}
                    {readable((e.summary ?? e.action).replace(/^[A-Z]{2,4}-\d{4}-\d+: /, ""))}
                    {showStep && e.step && <span className="text-muted"> · {FLOW_STEP_LABEL[e.step as FlowStep] ?? e.step}</span>}
                  </span>
                  {change && (
                    <span className="block text-muted">
                      was {change.from && /^\d{4}-\d{2}-\d{2}$/.test(change.from) ? date(change.from) : change.from}
                    </span>
                  )}
                  <span className="block text-muted">{dateTime(e.at)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-4 py-3.5 text-xs text-muted">Nothing changed here yet.</p>
      )}
    </Card>
  );
}
