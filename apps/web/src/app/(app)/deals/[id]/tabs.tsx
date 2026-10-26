"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@kebo/ui";

export function DealTabs({ id, source, orderId }: { id: string; source: boolean; orderId: string | null }) {
  const path = usePathname();
  const base = `/deals/${id}`;
  const tabs = [
    { href: base, label: "Overview" },
    ...(source ? [{ href: `${base}/sourcing`, label: "Factory prices" }] : []),
    { href: `${base}/quotation`, label: "Quotation" },
    ...(orderId ? [{ href: `/orders/${orderId}`, label: "Order →" }] : []),
  ];
  return <LinkTabs label="Deal sections" tabs={tabs.map((t) => ({ ...t, active: t.href === base ? path === base : path.startsWith(t.href) }))} />;
}
