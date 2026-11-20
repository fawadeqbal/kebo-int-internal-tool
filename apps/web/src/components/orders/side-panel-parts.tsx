"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { boxTitleClass, cardClass, cn, EmptyLine, linkClass, RULES } from "@kebo/ui";

/** How many rows a section shows before it folds behind "Show all n" (phone); on a wide screen it scrolls after about six. */
const ROWS = 5;

/**
 * The one side panel's card (every record and step: orders, inquiries, customers, suppliers, people): a Card,
 * sticky under the top bar on a wide screen while it fits the window (taller, it scrolls with the page).
 */
export function SidePanelCard({ children, label }: { children: ReactNode; /** Its name as a region; left out when a labelled <aside> already holds it. */ label?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight + 128 <= window.innerHeight);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    check();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <section
      ref={ref}
      aria-label={label}
      data-sticky={fits ? "" : undefined}
      className={cn(cardClass, fits && "lg:sticky lg:top-28")}
    >
      {children}
    </section>
  );
}

/**
 * One section of every side panel (records and steps alike): "Title n" and its button, then two-line rows —
 * about six, then the list scrolls inside (desktop), or five and "Show all n"
 * (phone) — then an optional footer (the costs' total).
 */
export function SideSection({
  target,
  title,
  count,
  action,
  lead,
  empty,
  footer,
  dense,
  children,
}: {
  /** A stable name for the section (data-target). */
  target?: string;
  title: string;
  count?: number;
  action?: ReactNode;
  /** Above its rows (a picker). */
  lead?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  /** Changes: scrolls after 300px (the rest 330px). */
  dense?: boolean;
  children?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  // A list that scrolls inside can be reached and scrolled from the keyboard.
  const list = useRef<HTMLUListElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [rows.length]);
  return (
    <section aria-label={title} data-target={target} data-target-card={target ? "" : undefined} className={cn(RULES.box.inset, "border-b border-line pt-3.5 pb-3 last:border-b-0")}>
      <div className="mb-1 flex min-h-8 items-center justify-between gap-2">
        <h3 className={boxTitleClass}>
          {title}
          {count !== undefined && <span className="ml-1.5 text-md font-normal text-muted tabular">{count}</span>}
        </h3>
        {action && <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{action}</span>}
      </div>
      {lead}
      {rows.length ? (
        <ul
          ref={list}
          tabIndex={scrolls ? 0 : undefined}
          aria-label={scrolls ? title : undefined}
          className={cn(
            "[scrollbar-width:thin] lg:-mr-2.5 lg:overflow-y-auto lg:pr-2.5",
            dense ? "lg:max-h-[300px]" : "lg:max-h-[330px]",
            !all && "max-lg:[&>li:nth-child(n+6)]:hidden",
          )}
        >
          {rows}
        </ul>
      ) : (
        empty && <EmptyLine className="my-1.5">{empty}</EmptyLine>
      )}
      {rows.length > ROWS && !all && (
        <button type="button" className={cn(linkClass, "mt-1 text-sm lg:hidden")} onClick={() => setAll(true)}>
          Show all {rows.length}
        </button>
      )}
      {footer}
    </section>
  );
}

