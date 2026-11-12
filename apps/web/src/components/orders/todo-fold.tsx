import type { ReactNode } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { ChecklistItem } from "@/lib/types-checklist";

/**
 * A step's to-do list folded to one thin line (claude/payments-design.md): what is done and what is still
 * open, in the items' own words. The whole list, with its forms, opens under it. It starts open when there
 * is something to do in it now.
 */
export function TodoFold({
  label,
  items,
  waits = {},
  open,
  children,
}: {
  label: string;
  items: ChecklistItem[];
  /** What each waiting item waits for, by item (id, key or title). */
  waits?: Record<string, string>;
  open: boolean;
  children: ReactNode;
}) {
  const closed = (i: ChecklistItem) => i.done || i.skipped;
  const done = items.filter(closed).length;
  if (!items.length) return <>{children}</>;
  return (
    <details open={open} className="group order-first">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm group-open:mb-1.5 group-open:justify-end group-open:border-0 group-open:bg-transparent group-open:p-0 [&::-webkit-details-marker]:hidden">
        <span className="font-bold group-open:hidden">
          To do in {label} <span className="font-normal text-text-2">· {done} of {items.length} done</span>
        </span>
        {items.map((i) => {
          const wait = waits[i.id ?? i.key ?? i.title];
          return (
            <span key={i.id ?? i.key ?? i.title} className="inline-flex items-center gap-1.5 group-open:hidden">
              {closed(i) ? <CheckCircle2 className="size-4 shrink-0 text-ok" aria-label="Done" /> : <Circle className="size-4 shrink-0 text-line-strong" aria-label="Open" />}
              <span className={closed(i) ? "text-text-2" : "font-medium"}>
                {i.title}
                {!closed(i) && (i.late ? <span className="font-normal text-bad"> · late</span> : wait ? <span className="font-normal text-text-2"> · {wait.toLowerCase()}</span> : null)}
              </span>
            </span>
          );
        })}
        <span className="ml-auto text-[13px] font-medium text-primary group-open:hidden">Show the list</span>
        <span className="hidden text-[13px] font-medium text-primary group-open:inline">Hide the list</span>
      </summary>
      {children}
    </details>
  );
}
