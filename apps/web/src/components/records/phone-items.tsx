"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, capsClass } from "@kebo/ui";
import { BottomSheet } from "@/components/common/bottom-sheet";

/** One item as a phone shows it on a record's page: the same item line as in its window, read only. */
export interface ItemsPhoneRow {
  key: string;
  no: string;
  /** A part of an item (2.1): right under it, in line with it. */
  part: boolean;
  title: ReactNode;
  /** Under the name (the model). */
  under?: ReactNode;
  /** The grey line: how many × the price, the offers… */
  sub: ReactNode;
  /** On the right (the amount; or what is missing, in orange). */
  amount?: ReactNode;
  /** A line more under the grey one (the margin). */
  more?: ReactNode;
  /** After the name (Edited 2×). */
  badge?: ReactNode;
  /** What a tap shows (the item read only, and its one button); none: the row is not a button. */
  sheet?: { sub?: ReactNode; body: ReactNode };
}

/** How many rows show before "Show all" (an item's parts stay with it). */
const SHOWN = 5;

/**
 * The items of a record's page on a phone (design "Items on a small phone", the detail pages): the item line of the
 * edit window — number, name, model, the grey line and the amount on the right, a part in line with its item — with ›
 * in place of ⋯. Up to five show, then "Show all 8 items" opens the rest in place. A tap opens the item read only in a
 * sheet (its offers, its changes, our cost…), whose one button opens the box's window; the sheet closes as it does.
 */
export function PhoneItems({ label, rows, noun = "item" }: { label: string; rows: ItemsPhoneRow[]; noun?: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ItemsPhoneRow | null>(null);
  // The first five, and the parts of the fifth.
  let cut = rows.length;
  if (!all && rows.length > SHOWN + 1) {
    cut = SHOWN;
    while (cut < rows.length && rows[cut]!.part) cut++;
  }
  const shown = rows.slice(0, cut);
  return (
    <div className="sm:hidden">
      <ul aria-label={label} className="flex flex-col divide-y divide-line text-sm">
        {shown.map((r) => {
          const body = (
            <>
              <span
                className={cn(
                  "w-[34px] shrink-0 pt-0.5 text-md tabular",
                  r.part ? "font-medium text-muted" : "font-semibold text-text-2",
                )}
              >
                {r.no}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn("line-clamp-2 text-lead leading-snug [overflow-wrap:anywhere]", r.part ? "font-medium" : "font-semibold")}
                >
                  {r.title}
                  {r.badge}
                </span>
                {r.under && <span className="truncate text-xs text-muted">{r.under}</span>}
                <span className="mt-1 flex items-baseline justify-between gap-2 text-md text-text-2 tabular">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{r.sub}</span>
                  {r.amount && <span className="shrink-0 text-sm font-bold whitespace-nowrap text-text">{r.amount}</span>}
                </span>
                {r.more && <span className="mt-0.5 text-xs text-text-2 tabular">{r.more}</span>}
              </span>
              {r.sheet && <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />}
            </>
          );
          const box = "flex min-h-14 w-full items-start gap-1.5 py-2.5 pr-3 pl-4 text-left";
          return (
            <li key={r.key}>
              {r.sheet ? (
                <button type="button" aria-haspopup="dialog" onClick={() => setOpen(r)} className={cn(box, "active:bg-surface-2")}>
                  {body}
                </button>
              ) : (
                <div className={box}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {cut < rows.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex h-11 w-full items-center justify-center gap-1.5 border-t border-line text-md font-bold text-primary"
        >
          Show all {rows.length} {noun}s <ChevronDown className="size-4" aria-hidden />
        </button>
      )}
      {open?.sheet && (
        <BottomSheet
          title={
            <>
              {open.no} · {open.title}
            </>
          }
          sub={open.sheet.sub}
          onClose={() => setOpen(null)}
        >
          {/* Its one button opens the box's window (kept in the address): the sheet goes as it opens. */}
          <div
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a[href],button")) setOpen(null);
            }}
          >
            {open.sheet.body}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/** A label · value row of an item's sheet; `ours` shaded (our cost, the margin). */
export function SheetFact({ label, children, ours }: { label: string; children: ReactNode; ours?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 text-sm last:border-b-0",
        ours && "-mx-2 rounded-md border-b-0 bg-info-soft/60 px-2",
      )}
    >
      <span className="shrink-0 text-text-2">{label}</span>
      <span className="min-w-0 text-right font-semibold [overflow-wrap:anywhere] tabular">{children}</span>
    </div>
  );
}

/** A titled part of an item's sheet ("Offers for it", "Its changes"). */
export function SheetPart({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="px-4 py-2.5">
      {title && <h3 className={cn(capsClass, "mb-1.5")}>{title}</h3>}
      {children}
    </section>
  );
}
