"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { buttonClass, cn } from "@kebo/ui";

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
    <nav aria-label="Inquiry" className="no-print mt-4 flex items-stretch gap-6 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={here(t.href) ? "page" : undefined}
          className="-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-[13.5px] font-medium text-text-2 hover:text-text aria-[current]:border-primary-solid aria-[current]:font-bold aria-[current]:text-text"
        >
          {t.label}
          {t.tag && <span className="text-xs font-semibold text-text-2 tabular">{t.tag}</span>}
        </Link>
      ))}
      {order ? (
        <Link href={order.href} className="-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-[13.5px] font-semibold text-primary hover:underline">
          Order {order.refNo} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ) : (
        <span className="-mb-px flex h-11 shrink-0 items-center gap-1.5 text-[13.5px] font-medium text-muted" title="The sales order is made when the customer accepts an option">
          Order <span className="text-xs font-normal">when accepted</span>
        </span>
      )}
    </nav>
  );
}

/** The "Do next" card: what to do, one line about it, and its buttons (one orange, the quiet ones before it). */
export function NextCard({ title, meta, late, children }: { title: string; meta?: string; late?: boolean; children?: React.ReactNode }) {
  return (
    <section aria-label="Do next" className="no-print flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <span className={cn("text-xs font-semibold", late ? "text-bad" : "text-action")}>Do next</span>
        <span className="text-[17px] leading-snug font-bold">{title}</span>
        {meta && <span className="text-[13px] text-text-2">{meta}</span>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 max-sm:w-full [&>*]:max-sm:flex-1">{children}</div>}
    </section>
  );
}

/**
 * "Do next" on the tabs where the thing is not done: what it is and the way to its tab. On that tab itself
 * this shows nothing: the page has the same card with the working buttons.
 */
export function InquiryNext({ base, tab, title, meta, href, label }: { base: string; tab: "overview" | "sourcing" | "quotation"; title: string; meta: string; href?: string; label?: string }) {
  const at = usePathname();
  const first = at.slice(base.length).split("/")[1] ?? "";
  if (tab !== "overview" && first === tab) return null;
  // Full-width pages of their own (the request's edit form).
  if (first === "edit") return null;
  return (
    <div className="mt-4">
      <NextCard title={title} meta={meta}>
        {href && label && (
          <Link href={href} className={buttonClass("primary", "md")}>
            {label} <ArrowRight aria-hidden />
          </Link>
        )}
      </NextCard>
    </div>
  );
}
