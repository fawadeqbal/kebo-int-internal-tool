import type { ComponentProps, ReactNode } from "react";
import { cn, PageHeader, RULES } from "@kebo/ui";
import { OwnPagerTop, OwnPagerUnder } from "@/components/deals/own-pager";

/** ‹ 2 of 5 › to a record's siblings (an inquiry's offers, its quotations). */
export type RecordPager = Parameters<typeof OwnPagerTop>[0];

/** One section of a record's panel: its title, and what it holds (links to records, facts, notes). */
export interface PanelSection {
  /** Names the section for screen readers (aria-labelledby). */
  id: string;
  title: ReactNode;
  children: ReactNode;
}

/**
 * A record's page (canvas "RFQ Desk — the pieces", board "A record page, put together"; design rule 3): ‹ › to its
 * siblings beside the path (under the title on a phone), its header — the path, its name, the state in words, one
 * strong button and ⋯ (PageHeader) — then its boxes, with its panel beside them. The record's own page only says
 * what goes in each slot.
 */
export function RecordPage({
  pager,
  header,
  panel,
  children,
}: {
  pager?: RecordPager | null;
  /** PageHeader's props (crumbs, back, title, summary, primary, more…); on a phone the buttons go under the title. */
  header: Omit<ComponentProps<typeof PageHeader>, "children">;
  /** The panel beside the boxes; none: the boxes take the width. */
  panel?: { label: string; sections: PanelSection[] } | null;
  /** The boxes. */
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {pager && <OwnPagerTop {...pager} />}
      <PageHeader phoneStack {...header}>
        {pager && <OwnPagerUnder {...pager} />}
      </PageHeader>
      <div className={cn("grid items-start gap-4", panel && RULES.page.withPanel)}>
        <div className="min-w-0">{children}</div>
        {panel && <RecordPanel {...panel} />}
      </div>
    </div>
  );
}

/** The panel beside a record's boxes: its sections one under another, a line between them. */
export function RecordPanel({ label, sections }: { label: string; sections: PanelSection[] }) {
  return (
    <aside aria-label={label} className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {sections.map((s, i) => (
        <section key={s.id} aria-labelledby={s.id} className={cn("flex flex-col gap-1 px-4 py-3", i < sections.length - 1 && "border-b border-line")}>
          <h2 id={s.id} className="mb-1 text-[15px] font-semibold">
            {s.title}
          </h2>
          {s.children}
        </section>
      ))}
    </aside>
  );
}
