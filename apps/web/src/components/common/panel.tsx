"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button, buttonClass, cn, type ButtonSize, type ButtonVariant } from "@kebo/ui";
import { ConfirmDialog, focusables, useFocusTrap, useMounted } from "./dialog";

/* ---------------------------------------------------------------- closing */

/** What a form's onDone gets: a state that saved (`ok`) closes the panel at once; anything else asks first when there are changes. */
type CloseArg = { ok?: boolean } | unknown;
const PanelClose = createContext<(arg?: CloseArg) => void>(() => {});

/**
 * Inside a side panel: closes it. Pass it as a form's `onDone` (a saved form
 * closes it straight away) or as Cancel's onClick (with unsaved changes it
 * asks "Discard changes?" first).
 */
export const useClosePanel = () => useContext(PanelClose);

const saved = (arg: CloseArg) => !!arg && typeof arg === "object" && "ok" in arg && (arg as { ok?: boolean }).ok === true;

/* ---------------------------------------------------------------- the panel */

/**
 * The one way to create and edit (design system: side panel). It comes in
 * from the right over the page you are on: 600px on a desktop, 520px on a
 * laptop (≤1279px), the whole screen under 768px with Save pinned at the
 * bottom. Its title says which ("New customer", "Edit customer · Lahore
 * Pharma"); the body is a form in titled groups (PanelSection) with Save /
 * Cancel in a footer that stays in view (PanelActions).
 *
 * For everyone: role=dialog, aria-modal, named by its title; focus starts on
 * the first field, stays inside while it is open and goes back to the button
 * that opened it. Escape, ✕ or a click beside it closes it — after "Discard
 * changes?" when something was typed; Ctrl+Enter (⌘+Enter) saves.
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
  /** Unsaved changes, when the panel cannot tell by itself (it notices typing in its fields). */
  dirty?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const mounted = useMounted();
  const [typed, setTyped] = useState(false);
  const [asking, setAsking] = useState(false);
  const dirty = dirtyProp ?? typed;
  useFocusTrap(box, mounted);

  const request = useCallback(
    (arg?: CloseArg) => {
      if (saved(arg) || !dirty) onClose();
      else setAsking(true);
    },
    [dirty, onClose],
  );

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Focus starts on the first field (or the title when there is none).
  useEffect(() => {
    if (!mounted || !box.current) return;
    const body = box.current.querySelector<HTMLElement>("[data-panel-body]") ?? box.current;
    const first = focusables(body).find((el) => el.matches("input,select,textarea"));
    (first ?? head.current)?.focus({ preventScroll: true });
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end">
      {/* The dim page beside it: a click closes (the keyboard has Escape and ✕). */}
      <div aria-hidden className="absolute inset-0 animate-in bg-black/40" onClick={() => request()} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        onChange={() => setTyped(true)}
        onInput={() => setTyped(true)}
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
        className={cn(
          "relative flex h-dvh w-full animate-panel-in flex-col border-l border-line bg-surface shadow-pop md:w-[520px] md:max-w-[calc(100vw-2rem)] xl:w-[600px]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} ref={head} tabIndex={-1} className="text-base font-semibold outline-none">
              {title}
            </h2>
            {description && (
              <p id={`${id}-desc`} className="mt-0.5 text-xs text-muted">
                {description}
              </p>
            )}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close the panel" onClick={() => request()}>
            <X aria-hidden />
          </Button>
        </div>
        <PanelClose.Provider value={request}>{children}</PanelClose.Provider>
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
          What you changed in &ldquo;{title}&rdquo; is not saved yet.
        </ConfirmDialog>
      )}
    </div>,
    document.body,
  );
}

/**
 * A panel's scrolling body. A form inside takes its height (`PANEL_FORM`), so
 * its PanelActions stay at the bottom of the panel however short it is.
 */
export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-panel-body className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto p-5", className)}>
      {children}
    </div>
  );
}

/** The class of a form filling a PanelBody, so its PanelActions sit at the bottom. */
export const PANEL_FORM = "flex flex-1 flex-col gap-5";

/** A section of a panel's form: a small-caps title, then its fields, two columns at most (one on a phone). */
export function PanelSection({ title, children, className, first }: { title?: string; children: ReactNode; className?: string; first?: boolean }) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-3", !first && "border-t border-line pt-5")}>
      {title && <legend className="float-left mb-1 w-full text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</legend>}
      <div className={cn("grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-2", className)}>{children}</div>
    </fieldset>
  );
}

/**
 * The panel's Save / Cancel, in a footer that stays at the bottom of the panel
 * while the form scrolls (pinned to the very bottom: -bottom-5 makes up for the
 * body's padding, so nothing shows under it); `end`: a quiet action on the
 * right (Remove this offer).
 */
export function PanelActions({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky -bottom-5 z-10 -mx-5 -mb-5 mt-auto flex flex-wrap items-center gap-3 border-t border-line bg-surface-2 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
      {end && <span className="ml-auto">{end}</span>}
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
      for (const [k, v] of Object.entries(patch)) if (v === null) p.delete(k);
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
