"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { buttonClass, Select, type ButtonSize, type ButtonVariant } from "./primitives";

/** Submit button that shows progress and blocks double submits. */
export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: ButtonVariant; size?: ButtonSize }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} aria-busy={pending} className={buttonClass(variant, size, className)} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingText : children}
    </button>
  );
}

/** Submit button that asks for confirmation first (for destructive or irreversible actions). */
export function ConfirmSubmit({
  message,
  children,
  ...props
}: ComponentProps<typeof SubmitButton> & { message: string }) {
  return (
    <SubmitButton
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </SubmitButton>
  );
}

/* ---------------------------------------------------------------- Toast */

export interface ToastInput {
  /** Short: "Saved", "Customer added · Lahore Pharma". */
  message: string;
  /** Undo where possible: called once, then the toast says what happened. */
  undo?: () => void | Promise<void>;
  /** A link instead (e.g. "Open"). */
  action?: { label: string; href: string };
}
interface ToastItem extends ToastInput {
  id: number;
}

let toastSeq = 0;
let toastNow: ToastItem | null = null;
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());

/** Shows the short note after a save ("Saved", with Undo where possible). One at a time; the newest wins. */
export function toast(input: ToastInput | string) {
  toastNow = { ...(typeof input === "string" ? { message: input } : input), id: ++toastSeq };
  emitToast();
}
function dismissToast(id: number) {
  if (toastNow?.id !== id) return;
  toastNow = null;
  emitToast();
}
const subscribeToast = (l: () => void) => {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
};

/** The toast on screen (bottom right; above the phone's bottom bar): ✓ message, Undo or a link, ✕. Hover keeps it. */
export function Toaster() {
  const t = useSyncExternalStore(subscribeToast, () => toastNow, () => null);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!t || held || busy) return;
    const timer = setTimeout(() => dismissToast(t.id), t.undo ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [t, held, busy]);
  if (!t) return null;
  const undo = async () => {
    if (!t.undo) return;
    setBusy(true);
    try {
      await t.undo();
      toast("Undone");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="no-print fixed inset-x-4 bottom-24 z-[95] flex animate-in items-center gap-3 rounded-xl bg-[#15211a] px-3.5 py-3 text-sm text-white shadow-pop sm:inset-x-auto sm:right-5 sm:min-w-72 lg:bottom-5 dark:bg-surface-3 dark:text-text"
    >
      <Check className="size-[18px] shrink-0 text-[#7bd39a]" aria-hidden />
      <span className="min-w-0 flex-1">{t.message}</span>
      {t.undo && (
        <button type="button" onClick={() => void undo()} disabled={busy} className="font-semibold text-[#9be0b2] hover:text-white disabled:opacity-60">
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
      {t.action && (
        <Link href={t.action.href} className="font-semibold text-[#9be0b2] hover:text-white" onClick={() => dismissToast(t.id)}>
          {t.action.label}
        </Link>
      )}
      <button onClick={() => dismissToast(t.id)} className="ml-1 rounded p-0.5 text-white/60 hover:text-white" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

/** The toasts, and the one a redirect asks for (?toast=…, then the URL is cleaned). In the app's layout. */
export function Toast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const message = params.get("toast");
  useEffect(() => {
    if (!message) return;
    toast(message);
    const next = new URLSearchParams(params.toString());
    next.delete("toast");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [message, params, pathname, router]);
  return <Toaster />;
}

/** A filter select that applies itself as soon as it changes. */
export function AutoSelect(props: ComponentProps<typeof Select>) {
  return <Select compact {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
