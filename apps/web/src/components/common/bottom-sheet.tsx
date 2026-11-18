"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@kebo/ui";
import { useFocusTrap, useMounted } from "./dialog";

/**
 * A sheet from the bottom of a phone's screen (design "Items on a small phone"): a title and one line under it,
 * then what it shows (all the totals, an item read only). Over a window too. Its way out is at the bottom (canvas
 * row "Cancel, not ✕"): Close across the sheet, or the buttons it is given (`footer`: Cancel · Save); Escape and a
 * tap beside it close it too. Focus stays inside while it is open and goes back where it was.
 */
export function BottomSheet({
  title,
  sub,
  children,
  onClose,
  footer,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Its buttons at the bottom (default: Close). */
  footer?: ReactNode;
}) {
  const id = useId();
  const mounted = useMounted();
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, mounted);
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => was?.focus?.({ preventScroll: true });
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div data-layer="" className="fixed inset-0 z-[120] flex flex-col justify-end">
      <div aria-hidden className="absolute inset-0 animate-in bg-black/40" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="relative flex max-h-[85dvh] animate-in flex-col rounded-t-2xl border-t border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-pop outline-none md:mx-auto md:mb-6 md:w-[420px] md:rounded-2xl md:border"
      >
        <span aria-hidden className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-line-strong" />
        <div className="border-b border-line px-4 pt-1 pb-2.5">
          <h2 id={`${id}-t`} className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">
            {title}
          </h2>
          {sub && <p className="text-[13px] text-text-2 tabular">{sub}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div className="flex shrink-0 gap-2 border-t border-line px-3 pt-2.5 [&>*]:min-h-12 [&>*]:flex-1">
          {footer ?? (
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
