"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { Button, cn } from "@kebo/ui";

/**
 * A record's side panel (design "the record page", 17 Nov). On a laptop it is the panel itself, beside every
 * tab. On a phone or tablet it folds into one bar ("Inquiry · Manager · follow-up tomorrow · 2 notes") that
 * opens the same panel as a sheet over the page, so the page starts with its work. The panel is drawn once:
 * the bar only shows or hides it.
 */
export function SideSheet({ title, summary, children }: { title: string; summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLButtonElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    bar.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    shut.current?.focus({ preventScroll: true });
    // The page under the sheet stays still.
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // A wider window shows the panel beside the page: the sheet is put away.
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => wide.matches && setOpen(false);
    wide.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = was;
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <>
      <button
        ref={bar}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface pr-3 pl-4 text-left shadow-card hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text lg:hidden"
      >
        {/* One slim line (canvas row "Every page's top on a phone"): its name, then what it holds. */}
        <span className="min-w-0 flex-1 truncate text-md text-text-2">
          <span className="font-semibold text-text">{title}</span>
          {summary ? <> · {summary}</> : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-text-2" aria-hidden />
      </button>
      <div className={cn("max-lg:hidden", open && "max-lg:fixed max-lg:inset-0 max-lg:z-[70] max-lg:block")}>
        {open && <div aria-hidden className="absolute inset-0 animate-in bg-black/40 lg:hidden" onClick={close} />}
        <div
          role={open ? "dialog" : undefined}
          aria-modal={open || undefined}
          aria-label={open ? title : undefined}
          onKeyDown={(e) => {
            if (open && e.key === "Escape" && !(e.target as HTMLElement).closest("[role=menu],[role=listbox],[role=alertdialog]")) {
              e.preventDefault();
              close();
            }
          }}
          className={cn(open && "max-lg:absolute max-lg:inset-x-0 max-lg:top-14 max-lg:bottom-0 max-lg:flex max-lg:flex-col max-lg:overflow-hidden max-lg:rounded-t-2xl max-lg:bg-surface max-lg:shadow-pop")}
        >
          {open && (
            <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 pr-1.5 pl-4 lg:hidden">
              <h2 className="text-lg font-bold">{title}</h2>
              <Button ref={shut} type="button" size="icon" variant="ghost" onClick={close} aria-label="Close">
                <X aria-hidden />
              </Button>
            </div>
          )}
          <div className={cn(open && "max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:pb-[env(safe-area-inset-bottom)] max-lg:[&>section]:rounded-none max-lg:[&>section]:border-0 max-lg:[&>section]:shadow-none max-lg:[&>section>section:first-child>div:first-child]:sr-only")}>
            {/* (In the sheet the first section's title row is the sheet's own title, above: hidden, still read out;
                so that section has no buttons on its title row.) */}
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
