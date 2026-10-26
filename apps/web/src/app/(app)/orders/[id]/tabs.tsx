"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@kebo/ui";

export function OrderTabs({ id }: { id: string }) {
  const path = usePathname();
  const base = `/orders/${id}`;
  const tabs = [
    { href: base, label: "Checklist" },
    { href: `${base}/factory-orders`, label: "Factory orders" },
    { href: `${base}/payments`, label: "Payments" },
    { href: `${base}/invoices`, label: "Invoices" },
    { href: `${base}/shipments`, label: "Shipments" },
  ];
  return <LinkTabs label="Order sections" tabs={tabs.map((t) => ({ ...t, active: t.href === base ? path === base : path.startsWith(t.href) }))} />;
}
