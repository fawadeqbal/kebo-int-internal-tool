"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@kebo/ui";
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
    <div className="fixed inset-0 z-[100] grid place-items-center p-4" data-layer>
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

/* ---------------------------------------------------------------- the one window */

/**
 * The frame every window shares (Modal and the URL-kept SidePanel): one look and one way everywhere.
 * Tablet and up: a window in the middle of the screen, as tall as its content (88% of the screen at most),
 * its width chosen for its form; a phone: the whole screen. Title and one line under it, ✕ on the right.
 */
export const WINDOW_LAYER = "fixed inset-0 flex md:items-start md:justify-center md:overflow-y-auto md:px-6 md:py-[6vh]";
export const WINDOW_BOX =
  "relative flex h-dvh w-full animate-in flex-col bg-surface shadow-pop md:h-auto md:max-h-[88vh] md:max-w-[calc(100vw-3rem)] md:overflow-hidden md:rounded-2xl md:border md:border-line";

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
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 id={`${id}-title`} ref={headRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
          {title}
        </h2>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-[13px] text-text-2">
            {description}
          </p>
        )}
      </div>
      <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={disabled}>
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
 * Escape, ✕ or a click beside it closes it (unless busy): at once when nothing in it was changed, after
 * "Discard changes?" when something was. Focus stays inside while it is open.
 */
export function Modal({
  title,
  sub,
  children,
  footer,
  onClose,
  busy,
  size = "md",
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  size?: "md" | "lg";
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
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 sm:px-6">{children}</div>
        {footer && <div className={WINDOW_FOOTER}>{footer}</div>}
      </div>
      {asking && (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            onClose();
          }}
        >
          What you changed here is not saved yet.
        </ConfirmDialog>
      )}
    </div>,
    document.body,
  );
}
