import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { FLOW_STEP_LABEL, STEP_PATH, type FlowStep, type StepState } from "@kebo/shared";
import { Badge, buttonClass, Card, CardHeader, cn } from "@kebo/ui";
import { date, dateTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import type { OrderSteps, StepView } from "@/lib/types-checklist";
import { GoToOnLoad } from "./go-to";

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

/** What a step's header shows: the order's StepView, or any step with a number, name, state and one line (no n/m: the inquiry). */
export type StepHeaderData = Pick<StepView, "number" | "label" | "state" | "stateLabel" | "line"> & { done?: number; total?: number };

/** The step's top: its number, name, state, n of m (when counted), one line on where it stands, progress, and its main buttons. */
export function StepHeader({ step, action, line }: { step: StepHeaderData; action?: ReactNode; line?: string }) {
  const counted = step.total !== undefined;
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
          {counted && (
            <span className="text-xs font-normal text-muted tabular">
              {step.done ?? 0} of {step.total} done
            </span>
          )}
        </h2>
        {(line ?? step.line) && <p className="mt-0.5 text-sm text-text-2">{readable(line ?? step.line)}</p>}
        {counted && <ProgressBar done={step.done ?? 0} total={step.total!} state={step.state} className="mt-2.5 max-w-md" />}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 has-[form]:basis-full sm:has-[form]:basis-auto">{action}</div>}
    </section>
  );
}

/** ← previous · next →, as links. */
export function StepPrevNext({ prev, next }: { prev: { href: string; label: string }; next: { href: string; label: string } }) {
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

/** The work area beside the side panel: 380px from 1024, 420px from 1280; under the page below that. */
export const SIDE_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]";

/** A step page's frame: the header, then its work area beside the side cards, then the way to the step before and after. */
export function StepFrame({
  header,
  side,
  prevNext,
  children,
}: {
  header: ReactNode;
  side?: ReactNode;
  prevNext?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {header}
      {side ? (
        <div className={cn("grid gap-5", SIDE_COLUMNS)}>
          <div className="flex min-w-0 flex-col gap-5">{children}</div>
          <aside aria-label="Beside the step" className="flex min-w-0 flex-col gap-5">{side}</aside>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      )}
      {prevNext}
    </div>
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
  return <StepPrevNext prev={prev} next={next} />;
}

/**
 * Every step page (order v5): the header card, then the checklist and, under
 * "What this step holds", the step's read-only view (details, lines) on the
 * left and the side panel (papers, costs, files, changes: StepSidePanel) on the
 * right — below on a phone — then the way to the step before and after.
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
    <StepFrame
      header={
        view ? (
          <StepHeader step={view} action={action} line={line} />
        ) : (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
            {FLOW_STEP_LABEL[step]} is switched off for your company.
          </p>
        )
      }
      side={side}
      prevNext={<PrevNext base={base} steps={steps.steps} here={step} />}
    >
      {children}
      {/* A checklist link from another step ("#goto=…") lands here lit up. */}
      <GoToOnLoad />
    </StepFrame>
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
          <Link href={historyHref} className={buttonClass("ghost", "sm")}>
            {showStep ? "History" : "All history"}
          </Link>
        }
      />
      {entries.length ? (
        <ol className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto px-4 [scrollbar-width:thin]">
          {entries.map((e) => {
            // A summary that already says "a → b" needs no "was".
            const change = /→/.test(e.summary ?? "") ? null : e.changes.find((c) => c.from && c.to);
            return (
              <li key={e.id} className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-2.5 py-2">
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary"
                >
                  {(e.by?.name ?? "S").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
                  <span className="block">
                    <span className="font-semibold">{e.by?.name ?? "System"}</span>{" "}
                    {readable((e.summary ?? e.action).replace(/^[A-Z]{2,4}-\d{4}-\d+: /, ""))}
                    {showStep && e.step && <span className="text-muted"> · {FLOW_STEP_LABEL[e.step as FlowStep] ?? e.step}</span>}
                  </span>
                  {change && (
                    <span className="block text-xs text-muted">
                      was {change.from && /^\d{4}-\d{2}-\d{2}$/.test(change.from) ? date(change.from) : change.from}
                    </span>
                  )}
                  <span className="block text-xs text-muted">{dateTime(e.at)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-4 py-3.5 text-sm text-muted">Nothing changed here yet.</p>
      )}
    </Card>
  );
}
