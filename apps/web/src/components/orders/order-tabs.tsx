"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Banknote, Box, CreditCard, Eye, Factory, FileText, History, List, Package, Receipt, Ship, ShoppingCart, Truck } from "lucide-react";
import { isPaperKind, PAPER_STEP, STEP_PATH, type FlowStep } from "@kebo/shared";
import { SectionNav } from "@kebo/ui";
import { StepBoxes, type StepNavStep } from "./step-nav";

/**
 * The order's navigation (board: Order): from a tablet up, the flow's six steps as boxes (Payment ·
 * Factory order · Production · Shipping · Documents & bank · Delivery & SAT, each with where it stands
 * and its state), then the order's pages as tabs: Overview · Items · Money · Payment · Factory ·
 * Production · Goods · Packing · Shipping · Documents · Delivery · Costs · History. On a phone the tabs
 * scroll in one row.
 */
export function OrderTabs({
  base,
  steps,
  costs,
}: {
  base: string;
  steps: (StepNavStep & { key: FlowStep })[];
  /** Costs, for those who see them. */
  costs?: { spent?: string } | null;
  /** Kept for callers: the tabs no longer show counts. */
  items?: number;
  notes?: number;
}) {
  const at = usePathname();
  // A paper's Make page (/orders/:id/papers/:kind) belongs to the paper's step.
  const paper = at.slice(base.length).match(/^\/papers\/([a-z-]+)/)?.[1];
  const path = paper && isPaperKind(paper) ? `${base}/${STEP_PATH[PAPER_STEP[paper]]}` : at;
  const under = (href: string) => (href === base ? path === base : path === href || path.startsWith(`${href}/`));
  const has = (k: FlowStep) => steps.some((s) => s.key === k);
  const tab = (href: string, label: string, mark: ReactNode) => ({ href, label, mark, active: under(href) });

  const tabs = [
    tab(base, "Overview", <Eye aria-hidden />),
    tab(`${base}/items`, "Items", <List aria-hidden />),
    tab(`${base}/money`, "Money", <CreditCard aria-hidden />),
    ...(has("payment") ? [tab(`${base}/payment`, "Payment", <Banknote aria-hidden />)] : []),
    ...(has("factory") ? [tab(`${base}/factory`, "Factory", <ShoppingCart aria-hidden />)] : []),
    ...(has("production") ? [tab(`${base}/production`, "Production", <Factory aria-hidden />)] : []),
    tab(`${base}/goods`, "Goods", <Box aria-hidden />),
    tab(`${base}/packing`, "Packing", <Package aria-hidden />),
    ...(has("shipping") ? [tab(`${base}/shipping`, "Shipping", <Ship aria-hidden />)] : []),
    ...(has("documents") ? [tab(`${base}/documents`, "Documents", <FileText aria-hidden />)] : []),
    ...(has("delivery") ? [tab(`${base}/delivery`, "Delivery", <Truck aria-hidden />)] : []),
    ...(costs ? [tab(`${base}/costs`, "Costs", <Receipt aria-hidden />)] : []),
    tab(`${base}/history`, "History", <History aria-hidden />),
  ];

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 max-md:hidden">
        <StepBoxes steps={steps} label="Order steps" isHere={under} />
        <SectionNav label="The order" phone="none" items={tabs} />
      </div>
      <SectionNav label="The order" className="mt-4 md:hidden" items={tabs} />
    </>
  );
}
