"use client";

import { usePathname } from "next/navigation";
import { Eye, History, List, Receipt } from "lucide-react";
import { isPaperKind, PAPER_STEP, STEP_PATH, type FlowStep } from "@kebo/shared";
import { SectionNav } from "@kebo/ui";
import { StepBoxes, StepMark, type StepNavStep } from "./step-nav";

/**
 * The order's navigation (board: Order): from a tablet up, the flow's six steps as boxes (Payment ·
 * Factory order · Production · Shipping · Documents & bank · Delivery & SAT, each with what is done and
 * its state), then the order's other pages as chips (Overview · Items · Costs · History). On a phone one
 * row of chips with every page, the steps marked. Money, goods and packing live inside their steps'
 * pages (Payment, Production, Shipping).
 */
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
  const under = (href: string) => (href === base ? path === base : path === href || path.startsWith(`${href}/`));

  const pages = [
    { href: base, label: "Overview", mark: <Eye aria-hidden />, active: under(base) },
    { href: `${base}/items`, label: "Items", mark: <List aria-hidden />, active: under(`${base}/items`), count: items ? String(items) : undefined },
    ...(costs ? [{ href: `${base}/costs`, label: "Costs", mark: <Receipt aria-hidden />, active: under(`${base}/costs`), count: costs.spent }] : []),
    { href: `${base}/history`, label: "History", mark: <History aria-hidden />, active: under(`${base}/history`), count: notes ? String(notes) : undefined },
  ];
  const stepChips = steps.map((s) => ({
    href: s.href,
    label: s.label,
    active: under(s.href),
    mark: <StepMark state={s.state} number={s.number} />,
    alert: s.state === "late",
    count: s.total !== undefined ? `${s.done ?? 0}/${s.total}` : undefined,
  }));

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 max-md:hidden">
        <StepBoxes steps={steps.map((s) => ({ ...s, status: s.status ?? (s.total !== undefined ? `${s.done ?? 0} of ${s.total} done` : undefined) }))} label="Order steps" isHere={under} />
        <SectionNav label="The order" phone="none" items={[pages[0]!, pages[1]!, ...stepChips, ...pages.slice(2)]} />
      </div>
      <SectionNav label="The order" className="mt-4 md:hidden" items={[pages[0]!, pages[1]!, ...stepChips, ...pages.slice(2)]} />
    </>
  );
}
