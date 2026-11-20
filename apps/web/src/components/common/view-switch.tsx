import Link from "next/link";
import type { ReactNode } from "react";
import { cn, segmentClass, segmentsClass } from "@kebo/ui";

export interface SwitchView {
  key: string;
  label: string;
  href: string;
  /** A short figure beside the label ("USD 34,340.03 due"), hidden on a phone. */
  hint?: string;
  /** Its colour, e.g. "text-warn". */
  tone?: string;
  /** An icon before the label (List, Board). */
  icon?: ReactNode;
  /** A count after the label ("Missing 2"), shown on a phone too. */
  count?: number;
}

/**
 * One of a few views of the same thing (List | Board, List | Compare, an order's or a customer's money): the one
 * switch (segmentClass, the same as Segmented and SegmentedChoice), as links, so each view has its own address.
 */
export function ViewSwitch({ label, views, current, className }: { label: string; views: SwitchView[]; current: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn(segmentsClass, className)}>
      {views.map((v) => (
        <Link key={v.key} href={v.href} scroll={false} aria-current={v.key === current ? "page" : undefined} className={segmentClass(v.key === current)}>
          {v.icon}
          {v.label}
          {v.count !== undefined && <span className="tabular text-text-2">{v.count}</span>}
          {v.hint && <span className={cn("hidden text-xs font-medium sm:inline", v.tone ?? "text-muted")}>{v.hint}</span>}
        </Link>
      ))}
    </nav>
  );
}
