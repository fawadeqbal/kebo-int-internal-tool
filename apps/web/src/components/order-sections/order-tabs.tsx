"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ORDER_TAB_LABEL, type OrderTab } from "@kebo/shared";

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
export function OrderTabs({ base, tabs }: { base: string; tabs: { key: OrderTab; word?: string }[] }) {
  const at = useTab(base);
  return (
    <nav aria-label="Order" className="no-print mt-4 flex gap-x-[22px] overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.key === "overview" ? base : `${base}/${t.key}`}
          aria-current={at === t.key ? "page" : undefined}
          className="-mb-px flex h-[42px] shrink-0 items-center gap-[7px] border-b-2 border-transparent text-[13.5px] font-medium text-text-2 hover:text-text aria-[current]:border-primary-solid aria-[current]:font-bold aria-[current]:text-text"
        >
          {ORDER_TAB_LABEL[t.key]}
          {t.word && <span className="text-xs font-semibold text-text-2">{t.word}</span>}
        </Link>
      ))}
    </nav>
  );
}
