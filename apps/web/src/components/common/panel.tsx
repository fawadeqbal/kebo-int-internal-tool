"use client";

import { lockScroll } from "@/lib/scroll-lock";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buttonClass, cn, RULES, type ButtonSize, type ButtonVariant } from "@kebo/ui";
import { useChanges, watchChanges } from "./changes";
import { useFormNotice } from "./form-notice";
import { focusables, ThrowAwayConfirm, useBackGuard, useFocusTrap, useMounted, WINDOW_BOX, WINDOW_LAYER, WindowHead, type LostInfo } from "./dialog";

/* ---------------------------------------------------------------- closing */

/** What a form's onDone gets: a state that saved (`ok`) closes the panel at once; anything else asks first when something was changed. */
type CloseArg = { ok?: boolean } | unknown;
const PanelClose = createContext<(arg?: CloseArg) => void>(() => {});

/**
 * Inside a side panel: closes it. Pass it as a form's `onDone` (a saved form
 * closes it straight away) or as Cancel's onClick (it asks "Discard your
 * changes?" first, only when something was really changed).
 */
export const useClosePanel = () => useContext(PanelClose);
/** Whether a footer is in a window (its Cancel closes that window). */
const InWindow = createContext(false);
/** For a window that is not a SidePanel (a page shown as a window) to give its forms the same Cancel. */
export function PanelCloseProvider({ value, children }: { value: (arg?: CloseArg) => void; children: ReactNode }) {
  return (
    <InWindow.Provider value>
      <PanelClose.Provider value={value}>{children}</PanelClose.Provider>
    </InWindow.Provider>
  );
}

/**
 * A window's Cancel (canvas row "Cancel, not ✕", approved 19 Nov): beside its save, the same in every window. It
 * closes the window — at once when nothing changed, else after "Discard your change?" — like Escape and the phone's
 * Back. On a phone it takes the ✕'s place (the ✕ steps aside while a window has one, globals.css); on a laptop the
 * ✕ stays too. `onClick`: a window that closes in its own way.
 */
export function WindowCancel({ label = "Cancel", onClick, disabled, className }: { label?: string; onClick?: () => void; disabled?: boolean; className?: string }) {
  const close = useClosePanel();
  return (
    <button type="button" data-window-cancel="" disabled={disabled} onClick={onClick ?? (() => close())} className={buttonClass("secondary", "md", className)}>
      {label}
    </button>
  );
}

const PanelDirty = createContext<(dirty: boolean | null) => void>(() => {});
/**
 * Inside a side panel: tells it whether there are unsaved changes, for an editor that knows by itself (a table
 * of lines kept in the page). `null` goes back to the panel comparing its fields with how they started.
 */
export const useReportDirty = () => useContext(PanelDirty);

const PanelLost = createContext<(lost: LostInfo | null) => void>(() => {});
/**
 * Inside a side panel: what closing it now would lose, in a few words ("Came by: Email → WhatsApp"), for its
 * "Discard your change?" question. A window that says nothing gets the plain question.
 */
export const useReportLost = () => useContext(PanelLost);

/**
 * The place in a window's footer, on a phone, for its items' total (design "Items on a small phone"): the footer
 * puts a FooterTotal where the total goes (beside Save, or on its own line above the buttons), and a list of
 * items inside the window shows its total there, so nothing floats over the items.
 */
const FooterSlot = createContext<{ el: HTMLElement | null; set: (el: HTMLElement | null) => void } | null>(null);
/** The window footer's place for a total (null: none here; the list shows its totals under the items). */
export const useFooterSlot = () => useContext(FooterSlot)?.el ?? null;

/** Where a window's footer shows its items' total on a phone: beside Save, or (`line`) on its own line above the buttons. */
export function FooterTotal({ line = false }: { line?: boolean }) {
  const slot = useContext(FooterSlot);
  return <span ref={slot?.set} data-footer-total="" className={cn("min-w-0 empty:hidden sm:hidden", line && "basis-full")} />;
}

const saved = (arg: CloseArg) => !!arg && typeof arg === "object" && "ok" in arg && (arg as { ok?: boolean }).ok === true;

/* ---------------------------------------------------------------- the panel */

/**
 * The one way to create and edit: a window in the middle of the page you are on (the same frame as every
 * other window, see WindowHead), 720px wide unless its form needs more; the whole screen on a phone, with
 * Save pinned at the bottom. Its title says which ("New customer", "Edit customer · Lahore Pharma"); the
 * body is a form in titled groups (PanelSection) with Save / Cancel in a footer that stays in view
 * (PanelActions).
 *
 * For everyone: role=dialog, aria-modal, named by its title; focus starts on
 * the first field, stays inside while it is open and goes back to the button
 * that opened it. Escape, ✕ (← on a phone), Cancel, Back or a click beside it
 * closes it at once when nothing was changed, and after "Discard your
 * changes?" when something was (typed and put back as it was is not a
 * change); Ctrl+Enter (⌘+Enter) saves.
 *
 * Open it with state (`onClose`) or from the URL with useSidePanel, so a link
 * opens it and Back closes it.
 */
export function SidePanel({
  title,
  description,
  onClose,
  dirty: dirtyProp,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** Unsaved changes, when the panel cannot tell by itself (it compares its fields with how they started). */
  dirty?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const mounted = useMounted();
  const [asking, setAsking] = useState(false);
  const [reported, setReported] = useState<boolean | null>(null);
  const [lost, setLost] = useState<LostInfo | null>(null);
  const changes = useChanges(box);
  useFocusTrap(box, mounted);
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const footerSlot = useMemo(() => ({ el: slotEl, set: setSlotEl }), [slotEl]);

  const request = useCallback(
    (arg?: CloseArg) => {
      if (saved(arg) || !(dirtyProp ?? reported ?? changes.changed())) onClose();
      else setAsking(true);
    },
    [dirtyProp, reported, changes, onClose],
  );

  useEffect(() => lockScroll(), []);
  // The phone's Back closes a form kept in the address by itself; with something typed it asks first.
  useBackGuard(
    () => request(),
    () => !!(dirtyProp ?? reported ?? changes.changed()),
  );

  // Focus starts on the first field (or the title when there is none).
  useEffect(() => {
    if (!mounted || !box.current) return;
    const body = box.current.querySelector<HTMLElement>("[data-panel-body]") ?? box.current;
    // The first field that can be typed in (a read-only box is only there to be read).
    // (Not an items list's Find: on a phone that would open the keyboard over the list.)
    const first = focusables(body).find((el) => el.matches("input:not([readonly]):not([data-items-find]),select,textarea:not([readonly])"));
    (first ?? head.current)?.focus({ preventScroll: true });
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className={cn(WINDOW_LAYER, "z-[80]")}>
      {/* The dim page behind it: a click closes (the keyboard has Escape and ✕). */}
      <div aria-hidden className="absolute inset-0 animate-in bg-black/40" onClick={() => request()} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        {...watchChanges(changes)}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          // A menu or a confirm on top handles its own keys.
          if (t.closest("[role=menu],[role=listbox],[role=alertdialog]")) return;
          if (e.key === "Escape") {
            e.preventDefault();
            request();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            const form = t.closest("form") ?? box.current?.querySelector("form");
            if (!form) return;
            e.preventDefault();
            form.requestSubmit();
          }
        }}
        className={cn(WINDOW_BOX, RULES.window.wideRows, className)}
      >
        <WindowHead id={id} title={title} description={description} onClose={() => request()} headRef={head} />
        <PanelCloseProvider value={request}>
          <PanelDirty.Provider value={setReported}>
            <PanelLost.Provider value={setLost}>
              <FooterSlot.Provider value={footerSlot}>{children}</FooterSlot.Provider>
            </PanelLost.Provider>
          </PanelDirty.Provider>
        </PanelCloseProvider>
      </div>
      {asking && (
        <ThrowAwayConfirm
          what={title}
          lost={lost}
          onKeep={() => setAsking(false)}
          onThrow={() => {
            setAsking(false);
            onClose();
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * A panel's scrolling body. A form inside takes its height (`PANEL_FORM`), so
 * its PanelActions stay at the bottom of the panel however short it is.
 */
export function PanelBody({ children, className, fill }: { children: ReactNode; className?: string; fill?: boolean }) {
  // The form's message after a save (what to fix, no connection) at the top, inside the form, in view.
  const notice = useFormNotice();
  return (
    <div
      data-panel-body
      className={cn(
        // `fill`: a steps window fills the panel and scrolls inside itself (its rail and buttons stay put).
        fill ? "flex min-h-0 flex-1 flex-col overflow-hidden *:min-h-0" : "flex min-h-0 flex-1 flex-col overflow-y-auto p-5 *:shrink-0 sm:px-6",
        className,
      )}
    >
      {notice}
      {children}
    </div>
  );
}

/** The class of a form filling a PanelBody, so its PanelActions sit at the bottom. */
export const PANEL_FORM = "flex flex-1 flex-col gap-5";

/** A section of a panel's form: a small-caps title, then its fields, two columns at most (one on a phone). */
export function PanelSection({
  title,
  sub,
  children,
  className,
  first,
  quiet,
  fill,
}: {
  title?: string;
  /** A few words after the title: what the section is for. */
  sub?: string;
  children: ReactNode;
  className?: string;
  first?: boolean;
  /** In a steps window the step's heading says what it is: the title stays for screen readers only. */
  quiet?: boolean;
  /** It takes the rest of the window on a laptop (a long list that scrolls inside itself). */
  fill?: boolean;
}) {
  const inner = <div className={cn("grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-2", className, fill && "md:flex md:min-h-0 md:flex-1 md:flex-col")}>{children}</div>;
  // A fieldset will not let its content shrink to the window (its content box keeps its full height), so a section
  // that fills the window is a labelled group instead.
  if (fill)
    return (
      <div role="group" aria-label={title} className={cn("flex min-w-0 flex-col gap-3 md:min-h-0 md:flex-1", !first && !quiet && "border-t border-line pt-5")}>
        {title && !quiet && <p className="text-sm font-bold text-text">{title}</p>}
        {inner}
      </div>
    );
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-3", !first && !quiet && "border-t border-line pt-5")}>
      {title && (
        <legend className={quiet ? "sr-only" : "float-left mb-1 w-full text-sm font-bold text-text"}>
          {title}
          {sub && <span className="text-xs font-normal text-muted max-sm:block sm:ml-2">{sub}</span>}
        </legend>
      )}
      {inner}
    </fieldset>
  );
}

/**
 * The panel's Save / Cancel, in a footer that stays at the bottom of the panel
 * while the form scrolls (pinned to the very bottom: -bottom-5 makes up for the
 * body's padding, so nothing shows under it); `end`: a quiet action on the
 * right (Remove this offer). On a phone the buttons share its width, big.
 */
export function PanelActions({
  children,
  end,
  className,
  cancel = true,
}: {
  children: ReactNode;
  end?: ReactNode;
  className?: string;
  /** Cancel first, in a window (false: the window's buttons already say how to leave). */
  cancel?: boolean;
}) {
  const inWindow = useContext(InWindow);
  return (
    <div
      data-window-footer=""
      className={cn(
        "sticky -bottom-5 z-10 -mx-5 -mb-5 mt-auto flex flex-wrap items-center gap-3 border-t border-line bg-surface px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6",
        // A phone: the buttons share the width, big, under the thumb.
        "max-md:[&>a]:min-h-12 max-md:[&>a]:flex-1 max-md:[&>button]:min-h-12 max-md:[&>button]:flex-1",
        className,
      )}
    >
      {cancel && inWindow && <WindowCancel />}
      {children}
      {end && <span className="ml-auto">{end}</span>}
    </div>
  );
}

/**
 * The footer of a window that makes or edits a record (inquiry, factory offer, quotation), the same in each:
 * a note or the red "Remove…" on the left; Cancel, the quiet saves, then the one orange save on the right.
 */
export function PanelFooter({ start, onCancel, children }: { start?: ReactNode; onCancel?: () => void; children: ReactNode }) {
  return (
    <PanelActions className="justify-end" cancel={false}>
      {start && <span className="mr-auto min-w-0 text-[12.5px] text-text-2 max-md:basis-full">{start}</span>}
      {/* `onCancel`: a form that leaves in its own way (an editor on the page) still has its Cancel here. */}
      {onCancel ? <WindowCancel onClick={onCancel} /> : <WindowCancelIn />}
      {children}
    </PanelActions>
  );
}

/** Cancel, when the footer is in a window (for a footer that places it itself: `cancel={false}` on PanelActions). */
export function WindowCancelIn() {
  return useContext(InWindow) ? <WindowCancel /> : null;
}

/** "What happens": said above the button of a window that changes a status or removes something. */
export function WhatHappens({ lines }: { lines: ReactNode[] }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-text-2 [&_strong]:text-text">
      <strong className="block">What happens</strong>
      {lines.filter(Boolean).map((l, n) => (
        <span key={n} className="block">
          · {l}
        </span>
      ))}
    </div>
  );
}

/** "Ctrl+Enter saves · Esc closes", beside a panel's buttons (not on a phone). */
export function PanelKeys() {
  return <span className="text-xs text-muted max-md:hidden">Ctrl+Enter saves · Esc closes</span>;
}

/* ---------------------------------------------------------------- in the URL */

/** The page (without its panel) a panel was opened from in this tab, so closing it can go Back. */
let openedFrom: string | null = null;

/** The current URL with some parameters changed (null: removed). */
function usePanelUrl() {
  const params = useSearchParams();
  const pathname = usePathname();
  return useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch))
        if (v === null) p.delete(k);
        else p.set(k, v);
      const qs = p.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );
}

/** Opens any URL side panel of this page (a menu's "Edit"): (name, record id). */
export function useOpenPanel() {
  const router = useRouter();
  const url = usePanelUrl();
  return useCallback(
    (name: string, recordId?: string) => {
      openedFrom = url({ panel: null, id: null });
      router.push(url({ panel: name, id: recordId ?? null }), { scroll: false });
    },
    [router, url],
  );
}

/**
 * A side panel kept in the URL (?panel=new-customer, ?panel=edit-customer&id=…),
 * so a link opens it, Back closes it and a reload keeps it. The page reads the
 * same parameters on the server to draw the panel with its data.
 */
export function useSidePanel(name: string) {
  const params = useSearchParams();
  const router = useRouter();
  const url = usePanelUrl();
  const opener = useOpenPanel();
  const open = params.get("panel") === name;
  const id = open ? params.get("id") : null;
  const without = useCallback((extra: Record<string, string> = {}) => url({ panel: null, id: null, ...extra }), [url]);

  /** The link that opens it (for a <Link> or an href). */
  const href = useCallback((recordId?: string) => url({ panel: name, id: recordId ?? null }), [url, name]);
  const openPanel = useCallback((recordId?: string) => opener(name, recordId), [opener, name]);

  /** Closes it: Back when it was opened from this page, else the page without it. `then`: parameters to add (e.g. what was saved). */
  const close = useCallback(
    (then?: Record<string, string>) => {
      const target = without(then);
      if (!then && openedFrom === target) router.back();
      else router.replace(target, { scroll: false });
      openedFrom = null;
    },
    [router, without],
  );

  return { open, id, href, openPanel, close };
}

/** A button that opens a URL side panel (the page's primary "New customer", a row's "Edit"). */
export function OpenPanelButton({
  panel,
  id,
  children,
  variant = "secondary",
  size = "md",
  className,
  label,
}: {
  panel: string;
  id?: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** For screen readers, when the visible text is shorter ("New" on a phone). */
  label?: string;
}) {
  const p = useSidePanel(panel);
  return (
    <a
      href={p.href(id)}
      aria-label={label}
      aria-haspopup="dialog"
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        p.openPanel(id);
      }}
    >
      {children}
    </a>
  );
}
