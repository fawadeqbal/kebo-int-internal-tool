"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn, Pending } from "@kebo/ui";

/**
 * A record's tabs, one look on every record (orders, inquiries, customers, suppliers): one row of names under
 * the record's header, the open one underlined in green, a short fact beside a name ("3", "R1 draft",
 * "sailed"). Each tab is its own address (a link opens the same tab), but looking at tabs is not a step back:
 * a tab replaces the one before in the browser's history. On a phone the row scrolls sideways.
 * (Chips are for narrowing a list; underlined tabs are for the pages of one record.)
 */
export interface TabRowItem {
  href: string;
  label: ReactNode;
  /** The short fact beside the name: a count, "R1 draft", "sailed". */
  tag?: ReactNode;
  /** The fact is bad news (late): drawn in red. */
  alert?: boolean;
  active: boolean;
}

export function TabRow({ label, items, end, className = "mt-4" }: { label: string; items: TabRowItem[]; end?: ReactNode; className?: string }) {
  return (
    <nav
      aria-label={label}
      className={cn("no-print flex items-stretch gap-x-[22px] overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          // Tabs swap in place: Back from any tab goes to where the record was opened from, not to the tab before.
          replace
          aria-current={t.active ? "page" : undefined}
          className="-mb-px flex h-[42px] shrink-0 items-center gap-[7px] border-b-2 border-transparent text-[13.5px] font-medium whitespace-nowrap text-text-2 hover:text-text aria-[current]:border-primary-solid aria-[current]:font-bold aria-[current]:text-text"
        >
          {t.label}
          {t.tag !== undefined && t.tag !== null && t.tag !== "" && (
            <span className={cn("text-xs font-semibold tabular", t.alert ? "rounded-md bg-bad-soft px-1.5 text-bad" : "text-text-2")}>{t.tag}</span>
          )}
          <Pending />
        </Link>
      ))}
      {end}
    </nav>
  );
}

export interface RecordTab {
  /** Under the record: "" for Overview, "orders" for /customers/:id/orders. */
  path: string;
  label: string;
  count?: ReactNode;
  alert?: boolean;
}

/** A customer's or supplier's tabs: the same row as an order's or an inquiry's, the current one from the path. */
export function RecordTabs({ base, label, tabs, className }: { base: string; label: string; tabs: RecordTab[]; className?: string }) {
  const at = usePathname();
  const items = tabs.map((t) => {
    const href = t.path ? `${base}/${t.path}` : base;
    return {
      href,
      label: t.label,
      tag: t.count === 0 ? undefined : t.count,
      alert: t.alert,
      active: t.path ? at === href || at.startsWith(`${href}/`) : at === base || at === `${base}/edit`,
    };
  });
  return <TabRow label={label} items={items} className={className} />;
}
