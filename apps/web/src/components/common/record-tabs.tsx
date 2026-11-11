"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SectionNav } from "@kebo/ui";

export interface RecordTab {
  /** Under the record: "" for Overview, "orders" for /customers/:id/orders. */
  path: string;
  label: string;
  count?: ReactNode;
  alert?: boolean;
}

/**
 * A customer's or supplier's tabs (design: Record — header, three or four figures, then tabs). One tab at a
 * time, each its own address, the current one from the path.
 */
export function RecordTabs({ base, label, tabs }: { base: string; label: string; tabs: RecordTab[] }) {
  const at = usePathname();
  const items = tabs.map((t) => {
    const href = t.path ? `${base}/${t.path}` : base;
    return {
      href,
      label: t.label,
      count: t.count === 0 ? undefined : t.count,
      alert: t.alert,
      active: t.path ? at === href || at.startsWith(`${href}/`) : at === base,
    };
  });
  return <SectionNav label={label} className="mt-4" items={items} />;
}
