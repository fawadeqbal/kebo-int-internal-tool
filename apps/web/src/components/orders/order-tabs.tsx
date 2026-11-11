"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { isPaperKind, PAPER_STEP, STEP_PATH, type FlowStep, type StepState } from "@kebo/shared";
import { cn, SectionNav } from "@kebo/ui";
import { StepMark, type StepNavStep } from "./step-nav";

/**
 * The order as an ERP record (step 5): Overview · Items · Payment · Purchase · Shipping · Documents · Costs ·
 * Notes. The six steps of the order flow live inside the tabs (Purchase: the factory order and production;
 * Shipping: the shipment and delivery & SAT), each with its checklist as before; a tab with two steps shows
 * them as a second row. A tab's mark and count are its steps' together (n/m done; red when one is late).
 */
const GROUPS: { key: string; label: string; steps: FlowStep[] }[] = [
  { key: "payment", label: "Payment", steps: ["payment"] },
  { key: "purchase", label: "Purchase", steps: ["factory", "production"] },
  { key: "shipping", label: "Shipping", steps: ["shipping", "delivery"] },
  { key: "documents", label: "Documents", steps: ["documents"] },
];

/** A group of steps in one state: late if one is, then now, done when all are. */
function groupState(steps: StepNavStep[]): StepState {
  if (steps.some((s) => s.state === "late")) return "late";
  if (steps.some((s) => s.state === "now")) return "now";
  if (steps.every((s) => s.state === "done")) return "done";
  return "todo";
}

function GroupMark({ state }: { state: StepState }) {
  if (state === "done")
    return (
      <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-ok text-white" aria-hidden>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full border-[1.5px]",
        state === "now" ? "border-primary bg-primary" : state === "late" ? "border-bad bg-bad" : "border-line-strong bg-surface",
      )}
    />
  );
}

const SR: Record<StepState, string> = { done: "done", now: "now", late: "late", todo: "later" };

export function OrderTabs({
  base,
  steps,
  items,
  costs,
  notes,
}: {
  base: string;
  steps: (StepNavStep & { key: FlowStep })[];
  /** How many lines the order has. */
  items: number;
  /** Costs, for those who see them (with what was spent). */
  costs?: { spent?: string } | null;
  /** Notes and follow-ups still open, if any. */
  notes?: number;
}) {
  const at = usePathname();
  // A paper's Make page (/orders/:id/papers/:kind) belongs to the paper's step.
  const paper = at.slice(base.length).match(/^\/papers\/([a-z-]+)/)?.[1];
  const path = paper && isPaperKind(paper) ? `${base}/${STEP_PATH[PAPER_STEP[paper]]}` : at;
  const under = (href: string) => path === href || path.startsWith(`${href}/`);

  const groups = GROUPS.map((g) => ({ ...g, steps: steps.filter((s) => g.steps.includes(s.key)) })).filter((g) => g.steps.length);
  const here = groups.find((g) => g.steps.some((s) => under(s.href)));

  const tabs = [
    { href: base, label: "Overview", active: path === base },
    { href: `${base}/items`, label: "Items", active: under(`${base}/items`), count: items ? String(items) : undefined },
    ...groups.map((g) => {
      const state = groupState(g.steps);
      const done = g.steps.reduce((t, s) => t + (s.done ?? 0), 0);
      const total = g.steps.reduce((t, s) => t + (s.total ?? 0), 0);
      return {
        href: g.steps[0]!.href,
        label: g.label,
        active: here?.key === g.key,
        mark: <GroupMark state={state} />,
        alert: state === "late",
        // relative: keeps the words for screen readers inside the scrolling row on a phone.
        count: total ? (
          <span className="relative">
            {done}/{total}
            <span className="sr-only"> done, {SR[state]}</span>
          </span>
        ) : undefined,
      };
    }),
    ...(costs ? [{ href: `${base}/costs`, label: "Costs", active: under(`${base}/costs`), count: costs.spent }] : []),
    { href: `${base}/history`, label: "Notes", active: under(`${base}/history`), count: notes ? String(notes) : undefined },
  ];

  return (
    <>
      <SectionNav label="The order" className="mt-4" items={tabs} />
      {here && here.steps.length > 1 && (
        <nav aria-label={`${here.label} steps`} className="no-print mt-3 flex flex-wrap gap-1.5">
          {here.steps.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              aria-current={under(s.href) ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium",
                under(s.href) ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-text-2 hover:text-text",
              )}
            >
              <StepMark state={s.state} number={s.number} />
              {s.label}
              {s.total !== undefined && (
                <span className={cn("relative text-[11px] tabular", s.state === "late" ? "text-bad" : "text-muted")}>
                  {s.done ?? 0}/{s.total}
                  <span className="sr-only"> done, {SR[s.state]}</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
