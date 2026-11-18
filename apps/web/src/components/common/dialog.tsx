"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import { Button, cn } from "@kebo/ui";
import { lockScroll } from "@/lib/scroll-lock";
import { useChanges, watchChanges } from "./changes";

const noop = () => () => {};
/** True in the browser, false while rendering on the server. */
export const useMounted = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/** A test DOM (jsdom) lays nothing out, so there everything counts as shown. */
const noLayout = () => typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");

/** What Tab can reach inside a box, in order (hidden ones left out). */
export function focusables(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden],[inert]") && (el.getClientRects().length > 0 || noLayout()),
  );
}

/**
 * Layers drawn over a dialog (its menus, a confirm, the toast) live outside it
 * in the page; focus may go there without being pulled back.
 */
const LAYER = "[data-layer],[role=menu],[role=listbox],[role=alertdialog],[role=status]";

/**
 * Keeps keyboard focus inside a dialog while it is open (Tab and Shift+Tab
 * go round), and gives it back to whatever had it before (the button that
 * opened it) when it closes.
 */
export function useFocusTrap(box: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const tab = (e: KeyboardEvent) => {
      const el = box.current;
      if (e.key !== "Tab" || !el) return;
      // A layer on top (a confirm) handles its own Tab.
      if (!el.contains(document.activeElement) && (document.activeElement as HTMLElement | null)?.closest(LAYER)) return;
      const items = focusables(el);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !el.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !el.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    const back = (e: FocusEvent) => {
      const el = box.current;
      const t = e.target as HTMLElement | null;
      if (!el || !t || el.contains(t) || t.closest(LAYER)) return;
      (focusables(el)[0] ?? el).focus();
    };
    document.addEventListener("keydown", tab);
    document.addEventListener("focusin", back);
    return () => {
      document.removeEventListener("keydown", tab);
      document.removeEventListener("focusin", back);
      // Give focus back to the opener, if it is still on the page.
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    };
  }, [box, active]);
}

/**
 * "Are you sure?" in the app's own words: a title, one line, a quiet way back
 * (focused first, so Enter never destroys anything by accident) and the action
 * — red when it removes or throws something away. Escape is the way back.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const mounted = useMounted();
  useFocusTrap(box, mounted);
  useEffect(() => {
    if (mounted) cancel.current?.focus();
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div className={cn("fixed inset-0 z-[100] grid place-items-center p-4", FIT_VIEW)} data-layer>
      {/* The dim backdrop: a click on it is the way back (the keyboard has Escape and the button). */}
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={children ? `${id}-d` : undefined}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (!busy) onCancel();
        }}
        className="relative w-full max-w-sm animate-in rounded-xl border border-line bg-surface p-5 shadow-pop"
      >
        <h2 id={`${id}-t`} className="text-base font-semibold">
          {title}
        </h2>
        {children && (
          <div id={`${id}-d`} className="mt-1.5 text-sm text-text-2">
            {children}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button ref={cancel} size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button size="sm" variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** What would be lost by closing a window now: its own question and the changes in a few words (design rules 18 Nov). */
export interface LostInfo {
  /** "Close without saving?" for a new record; "Discard your change?" by default. */
  title?: string;
  /** "This new inquiry isn’t saved yet." */
  text?: string;
  /** "Came by: Email → WhatsApp", "Items: 3 items, 2 parts". */
  lines?: string[];
}

/**
 * Asked when a window with something unsaved is closed (✕, Esc, Back, a click beside it): what would be lost,
 * then Keep editing — the strong button, focused, so Enter never loses anything — or Discard. On a phone it
 * comes up from the bottom, Keep editing wide on top. Nothing changed: it is never asked.
 */
export function ThrowAwayConfirm({ what, lost, onKeep, onThrow }: { what?: ReactNode; lost?: LostInfo | null; onKeep: () => void; onThrow: () => void }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const mounted = useMounted();
  useFocusTrap(box, mounted);
  useEffect(() => {
    if (mounted) keep.current?.focus();
  }, [mounted]);
  if (!mounted) return null;
  const lines = lost?.lines?.filter(Boolean) ?? [];
  const title = lost?.title ?? (lines.length > 1 ? "Discard your changes?" : "Discard your change?");
  const text = lost?.text ?? (what ? <>What you changed in &ldquo;{what}&rdquo; isn’t saved yet.</> : "It isn’t saved yet.");
  return createPortal(
    <div className={cn("fixed inset-0 z-[100] grid place-items-center p-4 max-sm:items-end max-sm:p-0", FIT_VIEW)} data-layer>
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onKeep} />
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onKeep();
        }}
        className="relative w-full max-w-[440px] animate-in rounded-2xl border border-line bg-surface p-5 shadow-pop max-sm:max-w-none max-sm:rounded-b-none max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <span aria-hidden className="mx-auto -mt-2 mb-3 block h-1 w-10 rounded-full bg-line sm:hidden" />
        <h2 id={`${id}-t`} className="text-[17px] font-bold">
          {title}
        </h2>
        <div id={`${id}-d`} className="mt-1 text-sm text-text-2">
          <p>{text}</p>
          {lines.length > 0 && (
            <ul className="mt-3 overflow-hidden rounded-xl border border-line text-[13.5px] text-text">
              {lines.slice(0, 6).map((l) => (
                <li key={l} className="border-t border-line px-3 py-2 first:border-t-0">
                  {l}
                </li>
              ))}
              {lines.length > 6 && <li className="border-t border-line px-3 py-2 text-text-2">and {lines.length - 6} more</li>}
            </ul>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2 max-sm:flex-col-reverse">
          <Button variant="danger-line" onClick={onThrow} className="max-sm:h-11 max-sm:w-full">
            <Trash2 aria-hidden /> Discard
          </Button>
          <Button ref={keep} variant="strong" onClick={onKeep} className="max-sm:h-12 max-sm:w-full">
            Keep editing
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- the phone's Back */

/** The browser's Navigation API, where it has one (Chrome, Edge, Android; Safari and Firefox lately). */
interface NavigateLike extends Event {
  navigationType: string;
  cancelable: boolean;
  userInitiated?: boolean;
  destination?: { index: number };
}
type Nav = { currentEntry: { index: number } | null; addEventListener(t: "navigate", f: (e: Event) => void): void; removeEventListener(t: "navigate", f: (e: Event) => void): void };
const navigationApi = () => (typeof window === "undefined" ? undefined : (window as unknown as { navigation?: Nav }).navigation);

/** The forms open now, the top one last: Back is for the top one. */
const guards: { handle: () => void; wants: () => boolean }[] = [];
function onNavigate(e: Event) {
  const ev = e as NavigateLike;
  const top = guards.at(-1);
  if (!top || ev.navigationType !== "traverse" || !ev.cancelable || ev.userInitiated === false || !top.wants()) return;
  // Only a step Back (not Forward): the form takes it.
  const now = navigationApi()?.currentEntry?.index ?? -1;
  if ((ev.destination?.index ?? -1) < 0 || now < 0 || (ev.destination?.index ?? 0) >= now) return;
  ev.preventDefault();
  top.handle();
}

/**
 * The browser's Back (a phone's back button or swipe) while a form is open goes to the form, not the page
 * under it, when `wants` says so: a form that is not in the address closes; one with something typed asks
 * "Discard your change?" first. Where the browser cannot hold Back (no Navigation API), it leaves as before.
 */
export function useBackGuard(handle: () => void, wants: () => boolean) {
  const latest = useRef({ handle, wants });
  useEffect(() => {
    latest.current = { handle, wants };
  });
  useEffect(() => {
    const nav = navigationApi();
    if (!nav) return;
    const guard = { handle: () => latest.current.handle(), wants: () => latest.current.wants() };
    guards.push(guard);
    if (guards.length === 1) nav.addEventListener("navigate", onNavigate);
    return () => {
      guards.splice(guards.indexOf(guard), 1);
      if (!guards.length) nav.removeEventListener("navigate", onNavigate);
    };
  }, []);
}

/* ---------------------------------------------------------------- the one window */

/**
 * The frame every window shares (Modal and the URL-kept SidePanel): one look and one way everywhere.
 * Tablet and up: a window in the middle of the screen, as tall as its content (88% of the screen at most),
 * its width chosen for its form; a phone: the whole screen. Title and one line under it, ✕ on the right.
 */
/**
 * On a phone a full-screen layer covers only the screen above the keyboard (KeyboardWatch keeps --vvh and --vvt),
 * so a window's title stays on top and its buttons sit right on the keyboard. Without a keyboard: the whole screen.
 */
export const FIT_VIEW = "max-md:bottom-auto max-md:top-[var(--vvt,0px)] max-md:h-[var(--vvh,100dvh)]";
export const WINDOW_LAYER = "fixed inset-0 flex max-md:bottom-auto max-md:top-[var(--vvt,0px)] max-md:h-[var(--vvh,100dvh)] md:items-start md:justify-center md:overflow-y-auto md:px-6 md:py-[6vh]";
export const WINDOW_BOX =
  "relative flex h-full w-full animate-in flex-col bg-surface shadow-pop md:h-auto md:max-h-[88vh] md:max-w-[calc(100vw-3rem)] md:overflow-hidden md:rounded-2xl md:border md:border-line";

export function WindowHead({
  id,
  title,
  description,
  onClose,
  disabled,
  headRef,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  disabled?: boolean;
  headRef?: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    // A window closes with ✕ on the right on a laptop. On a phone (the form fills the screen) its Cancel beside Save
    // does it, and the ✕ steps aside (canvas row "Cancel, not ✕", globals.css); a window without a Cancel keeps it,
    // at the top left.
    <div data-window-head="" className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 max-md:min-h-14 max-md:items-center max-md:justify-start max-md:gap-1 max-md:py-1.5 max-md:pr-4 max-md:pl-1 sm:px-6">
      <div className="min-w-0 max-md:order-2 max-md:flex-1">
        <h2 id={`${id}-title`} ref={headRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none max-md:line-clamp-2 max-md:text-base max-md:leading-snug">
          {title}
        </h2>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-[13px] text-text-2 max-md:line-clamp-2">
            {description}
          </p>
        )}
      </div>
      <Button data-window-x="" size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={disabled} className="max-md:order-1 max-md:size-11 max-md:rounded-full max-md:[&_svg]:size-[22px]">
        <X aria-hidden />
      </Button>
    </div>
  );
}

/** A window's buttons: Cancel and the save on the right, at the bottom, always in view. */
export const WINDOW_FOOTER =
  "flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6";

const MODAL_WIDTH = { md: "md:w-[600px]", lg: "md:w-[760px]" } as const;

/**
 * A window over the page (cancel an order, a file, a request): the same frame as every other window.
 * Escape, ✕ (← on a phone), the phone's Back or a click beside it closes it (unless busy): at once when nothing
 * in it was changed, after "Discard your change?" when something was. Focus stays inside while it is open.
 */
export function Modal({
  title,
  sub,
  children,
  footer,
  onClose,
  busy,
  size = "md",
  cancel = true,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  size?: "md" | "lg";
  /** Cancel first in its footer (false: the footer already says how to leave). */
  cancel?: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const [asking, setAsking] = useState(false);
  const changes = useChanges(box);
  useFocusTrap(box, mounted);
  useEffect(() => lockScroll(), []);
  const close = () => {
    if (busy) return;
    if (changes.changed()) setAsking(true);
    else onClose();
  };
  // A window is not a page: the phone's Back closes it (asking first when something was typed).
  useBackGuard(close, () => !busy);
  if (!mounted) return null;
  return createPortal(
    <div className={`${WINDOW_LAYER} z-[100]`} data-layer>
      <div aria-hidden className="fixed inset-0 animate-in bg-black/40" onClick={close} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={sub ? `${id}-desc` : undefined}
        {...watchChanges(changes)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          close();
        }}
        className={`${WINDOW_BOX} ${MODAL_WIDTH[size]}`}
      >
        <WindowHead id={id} title={title} description={sub} onClose={close} disabled={busy} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 *:shrink-0 sm:px-6">{children}</div>
        {footer && (
          <div className={cn(WINDOW_FOOTER, "max-md:[&>button]:min-h-12 max-md:[&>button]:flex-1")}>
            {cancel && (
              <Button type="button" variant="secondary" data-window-cancel="" onClick={close} disabled={busy}>
                Cancel
              </Button>
            )}
            {footer}
          </div>
        )}
      </div>
      {asking && (
        <ThrowAwayConfirm
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
