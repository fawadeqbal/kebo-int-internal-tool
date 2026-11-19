"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { TabRow } from "@kebo/ui";

/**
 * A record's tabs: the one TabRow (packages/ui), one look on every record (orders, inquiries, customers,
 * suppliers). Looking at tabs is not a step back: a tab replaces the one before in the browser's history.
 */
export { TabRow, type TabRowItem } from "@kebo/ui";

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
