"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buttonClass } from "@kebo/ui";
import { TabRow } from "@/components/common/record-tabs";

export interface InquiryTab {
  href: string;
  label: string;
  /** The short fact beside the name: "3", "R1 draft". */
  tag?: string;
}

/** Pages without a tab of their own count as the Overview (the request's edit form, all files). */
const UNDER_OVERVIEW = ["edit", "files", "needs"];

/**
 * The inquiry's one row of tabs: Overview · Factory offers · Quotations · Costs · History, then Order.
 * Order is grey ("when accepted") until the customer accepts; then it is the way to the sales order.
 * On a phone the row scrolls sideways.
 */
export function InquiryTabs({ base, tabs, order }: { base: string; tabs: InquiryTab[]; order: { href: string; refNo: string } | null }) {
  const at = usePathname();
  const first = at.slice(base.length).split("/")[1] ?? "";
  const here = (href: string) => (href === base ? at === base || UNDER_OVERVIEW.includes(first) : at === href || at.startsWith(`${href}/`));
  return (
    <TabRow
      label="Inquiry"
      items={tabs.map((t) => ({ href: t.href, label: t.label, tag: t.tag, active: here(t.href) }))}
      end={
        order ? (
          <Link href={order.href} className="-mb-px flex h-[42px] shrink-0 items-center gap-1.5 border-b-2 border-transparent text-[13.5px] font-semibold whitespace-nowrap text-primary hover:underline">
            Order {order.refNo} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <span className="-mb-px flex h-[42px] shrink-0 items-center gap-1.5 text-[13.5px] font-medium whitespace-nowrap text-muted" title="The sales order is made when the customer accepts an option">
            Order <span className="text-xs font-normal">when accepted</span>
          </span>
        )
      }
    />
  );
}

/**
 * The inquiry's next step as the header's one orange button (the "Do next" card is gone, 17 Nov): its words
 * and the way to its tab. On that tab itself it shows nothing: the tab has the working button.
 */
export function InquiryNextButton({ base, tab, href, label }: { base: string; tab: "overview" | "sourcing" | "quotation"; href: string; label: string }) {
  const at = usePathname();
  const first = at.slice(base.length).split("/")[1] ?? "";
  if (tab !== "overview" && first === tab) return null;
  return (
    <Link href={href} className={buttonClass("primary", "md")}>
      {label} <ArrowRight aria-hidden />
    </Link>
  );
}
