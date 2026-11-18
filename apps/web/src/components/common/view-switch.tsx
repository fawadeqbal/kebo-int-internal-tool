import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@kebo/ui";

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
}

/**
 * One of a few views of the same thing (an order's or a customer's money):
 * a segmented switch of links, so each view has its own address.
 */
export function ViewSwitch({ label, views, current, compact }: { label: string; views: SwitchView[]; current: string; compact?: boolean | "sm" }) {
  return (
    // compact: as tall as the buttons beside it (the header's 40 px; "sm": a card's 36 px).
    <nav
      aria-label={label}
      className={cn(
        "inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-3 p-1",
        compact === "sm" ? "h-9 rounded-[10px] p-0.5 [&>a]:h-8 [&>a]:px-2.5 [&>a]:text-[13px] [&_svg]:size-4" : compact && "h-10 [&>a]:h-8 [&_svg]:size-4",
      )}
    >
      {views.map((v) => (
        <Link
          key={v.key}
          href={v.href}
          scroll={false}
          aria-current={v.key === current ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
            v.key === current ? "bg-surface font-semibold text-text shadow-sm" : "text-text-2 hover:text-text",
          )}
        >
          {v.icon}
          {v.label}
          {v.hint && <span className={cn("hidden text-xs font-medium sm:inline", v.tone ?? "text-muted")}>{v.hint}</span>}
        </Link>
      ))}
    </nav>
  );
}
