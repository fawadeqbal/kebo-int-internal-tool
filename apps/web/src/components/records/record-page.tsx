import type { ComponentProps, ReactNode } from "react";
import { boxTitleClass, cn, PageHeader, RULES } from "@kebo/ui";
import { OwnPagerTop, OwnPagerUnder } from "@/components/deals/own-pager";
import { SideSheet } from "@/components/common/side-sheet";
import { RecordShell } from "./record-frame";
import { SidePanelCard } from "@/components/orders/side-panel-parts";

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
 * The one panel beside a record's boxes (canvas board "What changes, piece by piece"): 320px on every record, and on
 * a phone one bar that opens it as a sheet. Given as:
 * - `sections`: its sections, and the bar's line on a phone (a supplier offer: Quoted in, Asked);
 * - `sheet`: a panel the record draws itself with SideSheet (an inquiry: who is responsible, the next follow-up, notes).
 */
export type RecordPanelProps = { label: string; sections: PanelSection[]; summary: ReactNode } | { label: string; sheet: ReactNode };

/**
 * A record's page (canvas "RFQ Desk — the pieces", board "A record page, put together"; design rule 3): its top,
 * then its boxes with its panel beside them. The record's own page only says what goes in each slot. A record
 * with tabs (an inquiry) puts RecordTop in its layout and RecordBody in each tab.
 */
export function RecordPage({
  pager,
  header,
  panel,
  children,
}: {
  pager?: RecordPager | null;
  header: RecordHeaderProps;
  panel?: RecordPanelProps | null;
  children: ReactNode;
}) {
  // The same frame as a record with tabs: the top stays (folding as the page scrolls), the panel beside the boxes.
  return (
    <RecordShell
      top={<RecordTop pager={pager} header={header} />}
      panelLabel={panel?.label}
      panel={panel ? ("sheet" in panel ? panel.sheet : <RecordPanel sections={panel.sections} summary={panel.summary} />) : null}
      folds
    >
      {children}
    </RecordShell>
  );
}

/** PageHeader's props (crumbs, back, title, summary, primary, more…); on a phone the buttons go under the title. */
export type RecordHeaderProps = Omit<ComponentProps<typeof PageHeader>, "children">;

/**
 * A record's top: ‹ › to its siblings beside the path (under the title on a phone; the page around it is
 * `relative`), the header — the path, its name, the state in words, one strong button and ⋯ — then a notice
 * (what needs a look) and its tabs.
 */
export function RecordTop({
  pager,
  header,
  notice,
  tabs,
}: {
  pager?: RecordPager | null;
  header: RecordHeaderProps;
  notice?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <>
      {pager && <OwnPagerTop {...pager} />}
      <PageHeader phoneStack {...header}>
        {pager && <OwnPagerUnder {...pager} />}
      </PageHeader>
      {notice && <div data-record-notice="">{notice}</div>}
      {tabs && <div data-record-tabs="">{tabs}</div>}
    </>
  );
}

/** The panel's sections one under another, a line between them; on a phone, a bar named by them that opens them. */
export function RecordPanel({ sections, summary }: { sections: PanelSection[]; summary: ReactNode }) {
  const title = sections.map((s) => (typeof s.title === "string" ? s.title : null)).filter(Boolean).join(" · ") || "More";
  return (
    <SideSheet title={title} summary={summary}>
      <SidePanelCard>
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={s.id} className={cn(RULES.box.inset, "flex flex-col gap-1 border-b border-line pt-3.5 pb-3 last:border-b-0")}>
            <h2 id={s.id} className={cn(boxTitleClass, "mb-1")}>
              {s.title}
            </h2>
            {s.children}
          </section>
        ))}
      </SidePanelCard>
    </SideSheet>
  );
}
