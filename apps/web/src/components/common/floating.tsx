"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@kebo/ui";

type Anchor = () => HTMLElement | null;

const PHONE = "(max-width: 639px)";

/** Where to put a panel of `w`×`h` next to the anchor: below it, or above when there is no room; always on screen. */
function place(rect: DOMRect, w: number, h: number, align: "start" | "end") {
  const gap = 4;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = rect.bottom + gap;
  const top = below + h > vh - 8 && rect.top - gap - h > 8 ? rect.top - gap - h : Math.min(below, Math.max(8, vh - h - 8));
  const wanted = align === "end" ? rect.right - w : rect.left;
  const left = Math.min(Math.max(8, wanted), Math.max(8, vw - w - 8));
  return { top, left };
}

const noop = () => () => {};
/** True in the browser, false while rendering on the server. */
const useMounted = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

function subscribePhone(cb: () => void) {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
export const useIsPhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );

/**
 * Keeps a panel next to its anchor while the page or any box around it
 * scrolls, and closes it on a click or tap outside or Escape.
 */
function useFloating(anchor: Anchor, onClose: () => void, opts: { width?: number | "anchor"; align: "start" | "end"; active: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  const update = useCallback(() => {
    const a = anchor();
    const p = panel.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const width = opts.width === "anchor" ? r.width : undefined;
    const w = width ?? p.offsetWidth;
    setPos({ ...place(r, w, p.offsetHeight, opts.align), width });
  }, [anchor, opts.width, opts.align]);

  useLayoutEffect(() => {
    if (!opts.active) return;
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [update, opts.active]);

  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor()?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      anchor()?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away, { passive: true });
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      document.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);

  return { panel, pos };
}

/** Shown in a menu with no item in it (a paper still waiting for its data): never an empty box. */
const EMPTY = "Nothing to do here yet.";
const emptyNote = (
  <p data-menu-empty className="px-2.5 py-1.5 text-xs text-muted">
    {EMPTY}
  </p>
);
/** The note hides itself as soon as the menu has an item. */
const HIDE_EMPTY = "[&:has([role=menuitem])>[data-menu-empty]]:hidden";

/**
 * A menu of actions for a button (⋯, "Later"…). Drawn in a layer above the
 * page (a portal, fixed next to its button), so a card or a scroll box around
 * the button never cuts it off; it flips above the button when there is no
 * room below, and stays next to it while the page scrolls. On a phone it opens
 * as a sheet from the bottom of the screen with large rows. With nothing in
 * it, it says so instead of showing an empty box.
 */
export function FloatingMenu({
  anchor,
  onClose,
  children,
  label,
  width = 240,
  align = "end",
  header,
}: {
  /** On a phone, shown at the top of the sheet in place of the label (a file's name and details). */
  header?: ReactNode;
  /** The button that opened it. */
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  /** For screen readers and the sheet's title on a phone. */
  label: string;
  width?: number;
  align?: "start" | "end";
}) {
  const phone = useIsPhone();
  const mounted = useMounted();
  const { panel, pos } = useFloating(anchor, onClose, { width, align, active: mounted && !phone });

  useEffect(() => {
    if (!mounted) return;
    panel.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus({ preventScroll: true });
  }, [mounted, phone, panel]);

  // Arrow keys move between the items, as in any menu.
  const keys = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]!.focus();
  };

  if (!mounted) return null;
  if (phone)
    return createPortal(
      <div className="fixed inset-0 z-[90] flex flex-col justify-end">
        <button
          type="button"
          aria-label="Close the menu"
          className="absolute inset-0 bg-black/40 animate-in fade-in"
          onClick={onClose}
          tabIndex={-1}
        />
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          onKeyDown={keys}
          className={cn(
            "relative flex max-h-[80dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-pop [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:text-base",
            HIDE_EMPTY,
          )}
        >
          <span className="mx-auto mb-1 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
          {header ?? <p className="px-2.5 pt-1 pb-2 text-xs font-medium text-muted">{label}</p>}
          {children}
          {emptyNote}
        </div>
      </div>,
      document.body,
    );
  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      onKeyDown={keys}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      className={cn(
        "fixed z-[90] flex max-h-[min(70vh,28rem)] flex-col overflow-y-auto rounded-lg border border-line bg-surface p-1 text-left shadow-pop",
        HIDE_EMPTY,
        !pos && "invisible",
      )}
    >
      {children}
      {emptyNote}
    </div>,
    document.body,
  );
}

/**
 * A list of suggestions under a text field (a combobox). Drawn above the page,
 * as wide as the field; it never opens as a sheet, so the field stays in view.
 */
export function FloatingList({
  anchor,
  onClose,
  children,
  className,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const mounted = useMounted();
  const { panel, pos } = useFloating(anchor, onClose, { width: "anchor", align: "start", active: mounted });
  if (!mounted) return null;
  return createPortal(
    <div
      ref={panel}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width }}
      className={cn("fixed z-[90] overflow-hidden rounded-xl border border-line bg-surface shadow-pop", !pos && "invisible", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
