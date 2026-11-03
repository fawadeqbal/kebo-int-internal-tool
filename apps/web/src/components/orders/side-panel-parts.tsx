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

/** How many one-line rows a section shows before it scrolls (desktop) or folds behind "Show all n" (phone). */
const ROWS = 5;

/**
 * The step side panel's card: sticky under the order's top bar on a wide
 * screen while it fits the window (taller, it scrolls with the page).
 */
export function SidePanelCard({ children, label }: { children: ReactNode; label: string }) {
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
 * One section of the panel: "Title n" and its button, then one-line rows — at
 * most five, then the list scrolls inside (desktop) or shows "Show all n"
 * (phone) — then an optional footer (the costs' total).
 */
export function SideSection({
  title,
  count,
  action,
  empty,
  footer,
  dense,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  /** Changes: 30px rows (the rest 34px). */
  dense?: boolean;
  children?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  return (
    <section aria-label={title} className="border-b border-line px-3.5 pt-2.5 pb-2 last:border-b-0">
      <div className="mb-0.5 flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">
          {title}
          {count !== undefined && <span className="ml-1 text-xs font-normal text-muted tabular">{count}</span>}
        </h3>
        {action && <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{action}</span>}
      </div>
      {rows.length ? (
        <ul
          className={cn(
            "[scrollbar-width:thin] lg:-mr-2 lg:overflow-y-auto lg:pr-2",
            dense ? "lg:max-h-[151px]" : "lg:max-h-[171px]",
            !all && "max-lg:[&>li:nth-child(n+6)]:hidden",
          )}
        >
          {rows}
        </ul>
      ) : (
        empty && <p className="my-1 text-xs text-muted">{empty}</p>
      )}
      {rows.length > ROWS && !all && (
        <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline lg:hidden" onClick={() => setAll(true)}>
          Show all {rows.length}
        </button>
      )}
      {footer}
    </section>
  );
}

/** "PR-2026-0031-1" → "PR-…-1" when it would not fit; short numbers stay whole. */
const shortNumber = (n: string) => (n.length > 12 ? n.replace(/^([A-Z]{2,4})-.*-(\w+)$/, "$1-…-$2") : n);

/** A paper on one line: ✓ / •, its name, its number or what it waits for ("Make", "missing"), and its ⋯ menu. */
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
  const what = done ? (r.number ? shortNumber(r.number) : (sub ?? r.stateLabel.toLowerCase())) : r.state === "miss" ? "missing" : null;
  return (
    <li className="flex h-[34px] items-center gap-2 border-b border-line last:border-b-0">
      <span className="grid w-3.5 shrink-0 place-items-center">
        {done ? (
          <Check className="size-3.5 text-ok" strokeWidth={3} role="img" aria-label="Ready" />
        ) : (
          <span role="img" aria-label="Open" className={cn("size-1.5 rounded-full", r.state === "miss" ? "bg-warn" : "bg-primary")} />
        )}
      </span>
      <Link href={canMakeIt ? make! : papersHref} className="min-w-0 flex-1 truncate text-[13px] font-medium hover:text-primary" title={r.label}>
        {r.label}
      </Link>
      {canMakeIt ? (
        <Link href={make!} className="shrink-0 text-xs text-muted hover:text-primary hover:underline">
          {r.state === "draft" ? "Continue" : "Make"}
        </Link>
      ) : (
        <span className="max-w-[45%] shrink-0 truncate text-xs text-muted tabular" title={r.number ?? undefined}>
          {what ?? r.stateLabel.toLowerCase()}
        </span>
      )}
      <PaperMenu
        r={r}
        orderId={orderId}
        canMake={canMake}
        canRecord={canRecord}
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

/** A file on one line: its icon, name (opens it), what it is attached to, 👁 and ⋯ — the order's file tools. */
export function SideFileRow({ file, set }: { file: OrderFile; set: OrderFile[] }) {
  const tools = useFileTools();
  const where = file.attachedTo.label.replace(/^(Checklist|Paper|Inquiry|Step) · /, "");
  return (
    <li className="flex h-[34px] items-center gap-2 border-b border-line last:border-b-0">
      <FileIcon file={file} />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-primary"
        title={file.name}
        onClick={() => tools?.view(file, set)}
      >
        {file.name}
      </button>
      <span className="max-w-[38%] shrink-0 truncate text-xs text-muted" title={where}>
        {where}
      </span>
      <button
        type="button"
        aria-label={`View ${file.name}`}
        className={buttonClass("ghost", "icon-xs", "hidden sm:inline-flex")}
        onClick={() => tools?.view(file, set)}
      >
        <Eye aria-hidden />
      </button>
      <FileMenuButton file={file} set={set} />
    </li>
  );
}
