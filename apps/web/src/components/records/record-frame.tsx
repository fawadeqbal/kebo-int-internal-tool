"use client";

import { SideSheet } from "@/components/common/side-sheet";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { cn, RULES } from "@kebo/ui";

/** How far the page scrolls before the top folds into its slim line (px). */
const FOLD_AT = 120;
/** The app's own top bar, which the record's top sits under (px). */
const SHELL = 56;
/** The record's top once folded, on a laptop (px): what the panel has to fit under. */
const FOLDED = 105;

/**
 * A record with tabs, drawn once by its layout (canvas board "The top and the panel stay; only the body moves"):
 * its top (the header, a notice, the tabs) stays at the top of the page, folding into one slim line once the page
 * has scrolled; its panel stays beside the boxes; only the tab's boxes move. Changing tab keeps the top and the
 * panel as they are — a tab draws only its boxes.
 *
 * - `bare`: the first segments of deeper pages that have a top of their own (an inquiry's quotation or offer):
 *   there the frame steps aside.
 * - `wide`: tabs that need the page's full width (an order's paper): there the panel steps aside.
 */
export function RecordFrame({
  top,
  panel,
  panelLabel,
  folds,
  bare = [],
  wide = [],
  children,
}: {
  top: ReactNode;
  panel?: ReactNode;
  panelLabel?: string;
  /** The panel folds itself into its bar on a phone (a SideSheet: inquiry, order). Else RecordBody folds it. */
  folds?: boolean;
  bare?: string[];
  wide?: string[];
  children: ReactNode;
}) {
  const segments = useSelectedLayoutSegments();
  const own = segments.length > 1 && bare.includes(segments[0] ?? "");
  const noPanel = wide.includes(segments[0] ?? "");
  if (own) return <>{children}</>;
  return (
    <RecordShell top={top} panel={noPanel ? null : panel} panelLabel={panelLabel} folds={folds}>
      {children}
    </RecordShell>
  );
}

/**
 * The record's top that stays (folding into one slim line once the page has scrolled) and, under it, the boxes
 * with the panel beside them, which stays too. RecordFrame (a record with tabs) and RecordPage (a record on one
 * page: a quotation, a supplier offer) both draw it.
 */
export function RecordShell({ top, panel, panelLabel, folds, children }: { top: ReactNode; panel?: ReactNode; panelLabel?: string; folds?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const [stuck, setStuck] = useState(false);
  const full = useRef(0);
  const [keep, setKeep] = useState(0);
  // The top's height now (full, or folded): the panel stays just under it.
  const [height, setHeight] = useState(112);

  // Folded once the mark (a little way into the top) has gone under the app's bar; back when it shows again.
  useEffect(() => {
    const el = mark.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const away = !e!.isIntersecting && e!.boundingClientRect.top < SHELL;
        if (away && box.current) full.current = box.current.offsetHeight;
        setStuck(away);
      },
      { rootMargin: `-${SHELL}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Folding makes the top shorter: the room it gave up is kept under it, so nothing below jumps.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setKeep(stuck ? Math.max(0, full.current - el.offsetHeight) : 0);
  }, [stuck]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A field reached with Tab, or a part reached by its link (#items), stops under the top, not behind it
  // (WCAG 2.4.11): the page keeps that much room at its top when it scrolls to something.
  useEffect(() => {
    const root = document.documentElement;
    const wide = window.matchMedia("(min-width: 48rem)");
    const set = () => root.style.setProperty("scroll-padding-top", `${(wide.matches ? SHELL : 0) + height + 8}px`);
    set();
    wide.addEventListener("change", set);
    return () => {
      wide.removeEventListener("change", set);
      root.style.removeProperty("scroll-padding-top");
    };
  }, [height]);

  return (
    <div data-record-frame="" className="relative" style={{ "--record-top": `${SHELL + height}px`, overflowAnchor: "none" } as CSSProperties}>
      <span ref={mark} aria-hidden className="pointer-events-none absolute top-0 left-0 h-px w-px" style={{ top: FOLD_AT }} />
      <div ref={box} data-record-top="" data-stuck={stuck ? "" : undefined} className={cn(RULES.page.stack, "sticky top-0 z-20 -mx-4 bg-bg px-4 sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8 md:top-14")}>
        {top}
      </div>
      {/* The room the folded top gave up, as a block of its own: as a margin it ran into the body's top margin and
          16px went missing, so a page that just scrolled far enough to fold got shorter, unfolded, grew and folded
          again, many times a second (the flicker, 22 Nov 2026). */}
      <div aria-hidden data-record-keep="" style={{ height: keep }} />
      <RecordBody panel={panel} panelLabel={panelLabel} folds={folds} className="mt-4">
        {children}
      </RecordBody>
    </div>
  );
}

/**
 * The one record body (canvas row "The one of each, frames", RFOne): the record's boxes, and beside them its one
 * side panel, 320px from 1024 (RULES.page.withPanel) on every record — an inquiry, an order, a customer, a
 * supplier, a purchase order, a payment, a person, a client inquiry. Below 1024, one column with the panel first.
 * The panel stays in view while it fits under the top (rule 4); a taller one scrolls with the page, never with a
 * scrollbar of its own. RecordShell draws it under the record's top that stays; a page with its own PageHeader draws
 * it on its own.
 */
export function RecordBody({ panel, panelLabel, folds, className, children }: { panel?: ReactNode; panelLabel?: string; folds?: boolean; className?: string; children: ReactNode }) {
  const aside = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = aside.current;
    if (!el) return;
    // Room under the folded top, less what comes after the boxes (the copyright line), so it stays clear at the end.
    const check = () => setFits(el.offsetHeight <= window.innerHeight - SHELL - FOLDED - 120);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    check();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  const withPanel = !!panel;
  return (
    <div data-part="record-body" data-panel={withPanel ? "" : undefined} className={cn("grid items-start gap-4", withPanel ? RULES.page.withPanel : "grid-cols-[minmax(0,1fr)]", className)}>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {withPanel && (
        // On a phone its bar comes first, under the tabs; the panel opens from it. On a laptop it stays in view
        // while it fits (data-fits), else it scrolls with the page.
        <aside
          ref={aside}
          aria-label={panelLabel}
          data-record-panel=""
          data-fits={fits ? "" : undefined}
          className={cn("flex min-w-0 flex-col gap-4 max-lg:order-first", fits && "lg:sticky lg:top-[calc(var(--record-top,56px)+16px)]")}
        >
          {/* On a phone every record's panel is one bar under its top that opens it (live audit 20 Nov: a payment's
              history, a purchase order's dates came before the record itself). */}
          {folds ? panel : <SideSheet title={panelLabel ?? "More"} summary={null}>{panel}</SideSheet>}
        </aside>
      )}
    </div>
  );
}
