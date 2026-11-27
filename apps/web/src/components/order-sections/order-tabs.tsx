"use client";

import { usePathname } from "next/navigation";
import { ORDER_TAB_LABEL, STEP_PATH, type OrderTab } from "@kebo/shared";
import { TabRow } from "@/components/common/record-tabs";

/** Pages that belong to a tab without being it (their own address, the tab's place in the line). */
const INSIDE: Record<string, OrderTab> = { goods: "production", packing: "shipping", items: "overview", money: "payment", papers: "documents" };

/** The tab the address is under: every paper's own page counts as Documents. */
function useTab(base: string): OrderTab {
  const rest = usePathname().slice(base.length);
  const first = rest.split("/")[1] ?? "";
  if (!first) return "overview";
  return INSIDE[first] ?? (first as OrderTab);
}

/**
 * The order's tabs (the order without checklists): Overview, the six stages,
 * Costs and History. No numbers and no ticks: every tab is open from the
 * first day. A stage carries one small word for where it stands, read from
 * its data.
 */
/** A tab's address under the order: its key, but the supplier step's is "supplier" (the stored step is still factory). */
const pathOf = (key: OrderTab) => (key === "factory" ? STEP_PATH.factory : key);

export function OrderTabs({ base, tabs }: { base: string; tabs: { key: OrderTab; word?: string }[] }) {
  const at = useTab(base);
  return (
    <TabRow
      label="Order"
      items={tabs.map((t) => ({
        href: t.key === "overview" ? base : `${base}/${pathOf(t.key)}`,
        label: ORDER_TAB_LABEL[t.key],
        tag: t.word,
        active: at === pathOf(t.key),
      }))}
    />
  );
}
