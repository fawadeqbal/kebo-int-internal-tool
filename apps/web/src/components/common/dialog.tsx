"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@kebo/ui";
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

/**
 * A dialog over the page (board OrderCancel): a title and one line under it,
 * the close button, the body, and the footer's buttons. Escape, × or the
 * backdrop closes it (unless busy): at once when nothing in it was changed,
 * after "Discard changes?" when something was (the same rule as the side
 * panel). Focus stays inside while it is open.
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
  const close = () => {
    if (busy) return;
    if (changes.changed()) setAsking(true);
    else onClose();
  };
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto p-4" data-layer>
      <div aria-hidden className="fixed inset-0 bg-black/40" onClick={close} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        {...watchChanges(changes)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          close();
        }}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full animate-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop ${size === "lg" ? "max-w-3xl" : "max-w-xl"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={`${id}-t`} className="text-lg font-semibold">
              {title}
            </h2>
            {sub && <p className="text-sm text-text-2">{sub}</p>}
          </div>
          <Button size="sm" variant="secondary" aria-label="Close" onClick={close} disabled={busy} className="size-9 px-0">
            <span aria-hidden>×</span>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 sm:px-6">{footer}</div>}
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
