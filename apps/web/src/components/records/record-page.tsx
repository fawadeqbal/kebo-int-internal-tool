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
 * The panel beside a record's boxes, one of two kinds:
 * - `sections`: a plain panel, 300px, under the boxes on a phone (a supplier offer: Quoted in, Asked);
 * - `sheet`: the panel that stays beside every tab and folds into one bar on a phone (an inquiry: who is
 *   responsible, the next follow-up, notes), drawn by the record (SideSheet).
 */
export type RecordPanelProps = { label: string; sections: PanelSection[] } | { label: string; sheet: ReactNode };

/**
 * A record's page (canvas "RFQ Desk — the pieces", board "A record page, put together"; design rule 3): its top,
 * then its boxes with its panel beside them. The record's own page only says what goes in each slot. A record
 * with tabs (an inquiry) puts RecordTop in its layout and RecordBody in each tab.
 */
export function RecordPage({ pager, header, panel, children }: { pager?: RecordPager | null; header: RecordHeaderProps; panel?: RecordPanelProps | null; children: ReactNode }) {
  return (
    <div className="relative">
      <RecordTop pager={pager} header={header} />
      <RecordBody panel={panel}>{children}</RecordBody>
    </div>
  );
}

/** PageHeader's props (crumbs, back, title, summary, primary, more…); on a phone the buttons go under the title. */
export type RecordHeaderProps = Omit<ComponentProps<typeof PageHeader>, "children">;

/**
 * A record's top: ‹ › to its siblings beside the path (under the title on a phone; the page around it is
 * `relative`), the header — the path, its name, the state in words, one strong button and ⋯ — then a notice
 * (what needs a look) and its tabs.
 */
export function RecordTop({ pager, header, notice, tabs }: { pager?: RecordPager | null; header: RecordHeaderProps; notice?: ReactNode; tabs?: ReactNode }) {
  return (
    <>
      {pager && <OwnPagerTop {...pager} />}
      <PageHeader phoneStack {...header}>
        {pager && <OwnPagerUnder {...pager} />}
      </PageHeader>
      {notice}
      {tabs}
    </>
  );
}

/** A record's boxes and, beside them, its panel (`top`: what comes above both, like a state's box). */
export function RecordBody({ panel, top, children }: { panel?: RecordPanelProps | null; top?: ReactNode; children: ReactNode }) {
  if (panel && "sheet" in panel)
    return (
      <div className="flex flex-col gap-4">
        {top}
        <div className={cn("grid items-start gap-4", RULES.page.withSheetPanel)}>
          <div className="flex min-w-0 flex-col gap-4">{children}</div>
          {/* On a phone its bar comes first, under the tabs; the panel opens from it. */}
          <aside aria-label={panel.label} className="flex min-w-0 flex-col gap-4 max-lg:order-first">
            {panel.sheet}
          </aside>
        </div>
      </div>
    );
  return (
    <>
      {top}
      <div className={cn("grid items-start gap-4", panel && RULES.page.withPanel)}>
        <div className="min-w-0">{children}</div>
        {panel && <RecordPanel label={panel.label} sections={panel.sections} />}
      </div>
    </>
  );
}

/** The plain panel beside a record's boxes: its sections one under another, a line between them. */
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
