"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye } from "lucide-react";
import { paperDone } from "@kebo/shared";
import { buttonClass, cn } from "@kebo/ui";
import type { OrderFile } from "@/lib/types-files";
import { FileIcon, FileMenuButton, useFileTools } from "@/components/files/file-tools";
import { PaperMenu, type PaperLineRow } from "./papers-table";

/** How many rows a section shows before it folds behind "Show all n" (phone); on a wide screen it scrolls after about six. */
const ROWS = 5;

/**
 * The step side panel's card: sticky under the order's top bar on a wide
 * screen while it fits the window (taller, it scrolls with the page).
 */
export function SidePanelCard({ children, label }: { children: ReactNode; /** Its name as a region; left out when a labelled <aside> already holds it. */ label?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight + 128 <= window.innerHeight);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    check();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  return (
    <section
      ref={ref}
      aria-label={label}
      data-sticky={fits ? "" : undefined}
      className={cn("rounded-xl border border-line bg-surface shadow-card", fits && "lg:sticky lg:top-28")}
    >
      {children}
    </section>
  );
}

/**
 * One section of the panel: "Title n" and its button, then two-line rows —
 * about six, then the list scrolls inside (desktop), or five and "Show all n"
 * (phone) — then an optional footer (the costs' total).
 */
export function SideSection({
  target,
  title,
  count,
  action,
  empty,
  footer,
  dense,
  children,
}: {
  /** Where checklist links land (see goTo). */
  target?: string;
  title: string;
  count?: number;
  action?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  /** Changes: scrolls after 300px (the rest 330px). */
  dense?: boolean;
  children?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  // A list that scrolls inside can be reached and scrolled from the keyboard.
  const list = useRef<HTMLUListElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [rows.length]);
  return (
    <section aria-label={title} data-target={target} data-target-card={target ? "" : undefined} className="border-b border-line px-[18px] pt-3.5 pb-3 last:border-b-0">
      <div className="mb-1 flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">
          {title}
          {count !== undefined && <span className="ml-1.5 text-[13px] font-normal text-muted tabular">{count}</span>}
        </h3>
        {action && <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{action}</span>}
      </div>
      {rows.length ? (
        <ul
          ref={list}
          tabIndex={scrolls ? 0 : undefined}
          aria-label={scrolls ? title : undefined}
          className={cn(
            "[scrollbar-width:thin] lg:-mr-2.5 lg:overflow-y-auto lg:pr-2.5",
            dense ? "lg:max-h-[300px]" : "lg:max-h-[330px]",
            !all && "max-lg:[&>li:nth-child(n+6)]:hidden",
          )}
        >
          {rows}
        </ul>
      ) : (
        empty && <p className="my-1.5 text-sm text-muted">{empty}</p>
      )}
      {rows.length > ROWS && !all && (
        <button type="button" className="mt-1 text-sm font-medium text-primary hover:underline lg:hidden" onClick={() => setAll(true)}>
          Show all {rows.length}
        </button>
      )}
      {footer}
    </section>
  );
}

/** A paper in two lines: ✓ / • on the left, its whole name, under it its number or what it waits for ("can be made" links to make it), and its ⋯ menu. */
export function SidePaperRow({
  r,
  orderId,
  canMake,
  canRecord,
  sub,
}: {
  r: PaperLineRow;
  orderId: string;
  canMake: boolean;
  canRecord: boolean;
  /** "sent 14 Jan": the paper's own line when it has no number. */
  sub: string | null;
}) {
  const router = useRouter();
  const done = paperDone(r.state);
  const papersHref = `/orders/${orderId}/documents?tab=all#papers`;
  const make = r.makeable ? `/orders/${orderId}/papers/${r.kind}${r.ref ? `?ref=${r.ref}` : ""}` : null;
  const canMakeIt = !!make && canMake && !r.live && (r.state === "can" || r.state === "wait" || r.state === "draft");
  const what = done ? (r.number ?? sub ?? r.stateLabel.toLowerCase()) : r.state === "miss" ? "missing" : r.stateLabel.toLowerCase();
  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line py-2 last:border-b-0">
      <span className="grid place-items-center">
        {done ? (
          <Check className="size-4 text-ok" strokeWidth={3} role="img" aria-label="Ready" />
        ) : (
          <span role="img" aria-label="Open" className={cn("size-1.5 rounded-full", r.state === "miss" ? "bg-warn" : "bg-primary")} />
        )}
      </span>
      <span className="min-w-0">
        <Link href={canMakeIt ? make! : papersHref} className="block text-sm font-medium [overflow-wrap:anywhere] hover:text-primary">
          {r.label}
        </Link>
        {canMakeIt ? (
          <Link href={make!} className="block text-xs text-text-2 hover:text-primary hover:underline">
            {r.state === "draft" ? "draft · continue" : what}
          </Link>
        ) : (
          <span className={cn("block text-xs [overflow-wrap:anywhere] text-text-2", done && r.number && "tabular")}>{what}</span>
        )}
      </span>
      <PaperMenu
        r={r}
        orderId={orderId}
        canMake={canMake}
        canRecord={canRecord}
        size="icon-sm"
        lead={(item) => (
          <>
            {canMakeIt && item(r.state === "draft" ? "Continue the draft" : "Make", () => router.push(make!))}
            {item("Open in Papers", () => router.push(papersHref), "Documents")}
            <span role="separator" className="my-1 block h-px bg-line" />
          </>
        )}
      />
    </li>
  );
}

/** A file in two lines: its icon, its whole name (opens it), under it what it belongs to · who · when; 👁 and ⋯ — the order's file tools. */
export function SideFileRow({ file, set, meta }: { file: OrderFile; set: OrderFile[]; meta: string }) {
  const tools = useFileTools();
  return (
    <li data-target={`file.${file.sourceId}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line py-2 last:border-b-0">
      <FileIcon file={file} />
      <span className="min-w-0">
        <button
          type="button"
          className="block w-full text-left text-sm font-medium [overflow-wrap:anywhere] hover:text-primary"
          onClick={() => tools?.view(file, set)}
        >
          {file.name}
        </button>
        <span className="block text-xs [overflow-wrap:anywhere] text-text-2">{meta}</span>
      </span>
      <span className="flex items-center">
        <button
          type="button"
          aria-label={`View ${file.name}`}
          className={buttonClass("ghost", "icon-sm", "hidden sm:inline-flex [&_svg]:size-4")}
          onClick={() => tools?.view(file, set)}
        >
          <Eye aria-hidden />
        </button>
        <FileMenuButton file={file} set={set} className="size-8" />
      </span>
    </li>
  );
}
