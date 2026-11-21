"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Clock, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Button, cn, linkClass, subTitleClass } from "@kebo/ui";
import { ChangeText } from "@/components/common/change-words";

/** One change in a box's or a line's history: what changed (a line each), why, who and when. */
export interface HistoryEntry {
  lines: string[];
  reason: string | null;
  by: string | null;
  /** "18 Nov 2026 16:05". */
  at: string;
  /** "Added with the inquiry": the start, no reason. */
  start?: boolean;
}

/**
 * The clock on a box or a line (design rules 18 Nov): only its own changes, newest first — old → new, an orange
 * "Why" tag, who and when — and "All history". A popover on a laptop, a sheet from the bottom on a phone.
 */
export function HistoryButton({ title, entries, allHref }: { title: string; entries: HistoryEntry[]; allHref?: string }) {
  const [open, setOpen] = useState(false);
  // Where it opens: under the clock, kept on the screen (above the page, so a table or a card never cuts it off).
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 380, window.innerWidth - 388)) });
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`History of ${title.toLowerCase()}`}
        aria-expanded={open}
        aria-controls={`${id}-pop`}
        onClick={toggle}
        className={cn(open && "bg-primary-soft text-primary")}
      >
        <Clock aria-hidden />
      </Button>
      {open &&
        createPortal(
          <>
            <div aria-hidden className="fixed inset-0 z-[90] bg-black/40 sm:hidden" onClick={() => setOpen(false)} />
            <div
              ref={pop}
              id={`${id}-pop`}
              role="dialog"
              aria-label={`${title} · history`}
              style={at ? ({ "--top": `${at.top}px`, "--left": `${at.left}px` } as CSSProperties) : undefined}
              className="fixed z-[95] overflow-hidden border border-line bg-surface text-left shadow-pop max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-2xl max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:top-(--top) sm:left-(--left) sm:w-[380px] sm:rounded-xl"
            >
              <div className="flex items-center justify-between gap-2 border-b border-line py-1.5 pr-1.5 pl-4">
                <h3 className={subTitleClass}>{title} · history</h3>
                <Button size="icon-xs" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
                  <X aria-hidden />
                </Button>
              </div>
              <ol className="max-h-[min(60vh,420px)] scroll-y">
                {entries.map((e, n) => (
                  <li
                    key={n}
                    className="grid grid-cols-[10px_minmax(0,1fr)] gap-2.5 border-t border-line px-4 py-2.5 text-md first:border-t-0"
                  >
                    <span aria-hidden className={cn("mt-1.5 size-2 rounded-full", e.start ? "bg-line-strong" : "bg-primary-solid")} />
                    <span className="flex min-w-0 flex-col gap-1">
                      {e.lines.map((l) => (
                        <ChangeText key={l} text={l} />
                      ))}
                      {e.reason && (
                        <span className="self-start rounded-md bg-action-soft px-2 py-0.5 text-xs font-semibold text-action">
                          Why: {e.reason}
                        </span>
                      )}
                      <span className="text-xs text-text-2">{[e.by, e.at].filter(Boolean).join(" · ")}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {allHref && (
                <Link href={allHref} className={cn(linkClass, "block border-t border-line px-4 py-2.5 text-sm")}>
                  All history
                </Link>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
