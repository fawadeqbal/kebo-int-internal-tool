import Link from "next/link";
import { cn } from "@kebo/ui";

export interface SwitchView {
  key: string;
  label: string;
  href: string;
  /** A short figure beside the label ("USD 34,340.03 due"), hidden on a phone. */
  hint?: string;
  /** Its colour, e.g. "text-warn". */
  tone?: string;
}

/**
 * One of a few views of the same thing (an order's or a customer's money):
 * a segmented switch of links, so each view has its own address.
 */
export function ViewSwitch({ label, views, current }: { label: string; views: SwitchView[]; current: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-3 p-1">
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
          {v.label}
          {v.hint && <span className={cn("hidden text-xs font-medium sm:inline", v.tone ?? "text-muted")}>{v.hint}</span>}
        </Link>
      ))}
    </nav>
  );
}
