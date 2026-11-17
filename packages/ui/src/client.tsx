"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Clock, Loader2, X } from "lucide-react";
import { buttonClass, Select, type ButtonSize, type ButtonVariant } from "./primitives";

export { BackArrow, ListLink, NavMemoryKeeper, placeOf, readNav, writeNav, type NavMemory, type Place } from "./back";

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

/**
 * What happened, by kind (design "knowing what happened"): done (green ✓), waiting for someone (blue: sent to a
 * manager to verify), partly (amber: saved, but the file did not go), not done (red: no connection). The icon
 * and the words say it, never the colour alone.
 */
export type NoteKind = "done" | "wait" | "part" | "fail";

export interface ToastInput {
  /** One sentence that names the thing: "Customer Kabul Medical Supplies added", "Payment RC-2026-0042 recorded". */
  message: string;
  /** A quieter second line with the facts: "USD 2,000 from Gulf Foods Trading · 4,724.20 still to come". */
  detail?: string;
  /** What happened (default: done). */
  kind?: NoteKind;
  /** Undo where safe (not money or papers): called once, then the note says it was undone. */
  undo?: () => void | Promise<void>;
  /** The next step, as a link ("Open"). */
  action?: { label: string; href: string };
  /** More next steps: a link, or something to do ("Try again"). */
  actions?: { label: string; href?: string; run?: () => void }[];
}
interface ToastItem extends ToastInput {
  id: number;
}

let toastSeq = 0;
let toastNow: ToastItem | null = null;
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());

/** Shows the note after an action (one sentence, with its next step and Undo where safe). One at a time: the newest wins. */
export function toast(input: ToastInput | string) {
  toastNow = { ...(typeof input === "string" ? { message: input } : input), id: ++toastSeq };
  emitToast();
}
/** How many toasts have been asked for so far: tells whether something already said its own note. */
export function toastsShown() {
  return toastSeq;
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

/**
 * How long a note stays: 5 seconds, every kind (asked 17 Nov), with a line under it running out; never while
 * held (the pointer or the keyboard on it), and the time left carries on after.
 */
export const NOTE_MS = { plain: 5000, undo: 5000, fail: 5000 } as const;

const KINDS: Record<NoteKind, { icon: ReactNode; className: string; said: string }> = {
  done: { icon: <Check className="size-3.5" strokeWidth={3} aria-hidden />, className: "bg-[#2e8b57]", said: "Done" },
  wait: { icon: <Clock className="size-3.5" strokeWidth={2.75} aria-hidden />, className: "bg-[#2f6fd6]", said: "Waiting" },
  part: { icon: <span aria-hidden className="text-[13px] leading-none font-black">!</span>, className: "bg-[#b86e00]", said: "Partly done" },
  fail: { icon: <X className="size-3.5" strokeWidth={3} aria-hidden />, className: "bg-[#c2382b]", said: "Not done" },
};

/**
 * The note on screen: bottom right on a laptop, above the bottom bar on a phone. Its kind's icon, the sentence,
 * the facts under it, the next steps (Undo first), ✕. It waits while the pointer or the keyboard is on it;
 * screen readers say it as it comes (bad news at once, the rest after what they are reading).
 */
export function Toaster() {
  const t = useSyncExternalStore(subscribeToast, () => toastNow, () => null);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const kind = t?.kind ?? "done";
  const ms = !t ? 0 : t.undo ? NOTE_MS.undo : kind === "fail" ? NOTE_MS.fail : NOTE_MS.plain;
  // The time it has left: a new note starts with all of it; holding it stops the clock.
  const left = useRef(ms);
  useEffect(() => {
    left.current = ms;
  }, [t?.id, ms]);
  useEffect(() => {
    if (!t || held || busy) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(t.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [t, held, busy, ms]);
  if (!t) return null;
  const undo = async () => {
    if (!t.undo) return;
    setBusy(true);
    try {
      await t.undo();
      toast({ message: "Undone", detail: t.message });
    } catch (e) {
      toast({ kind: "fail", message: "Not undone", detail: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  const k = KINDS[kind];
  const link = "font-semibold text-note-link hover:text-note-fg hover:underline disabled:opacity-60";
  const steps = [...(t.action ? [{ label: t.action.label, href: t.action.href }] : []), ...(t.actions ?? [])];
  return (
    <div
      role={kind === "fail" ? "alert" : "status"}
      aria-live={kind === "fail" ? "assertive" : "polite"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      data-note={kind}
      className="no-print fixed inset-x-3 bottom-24 z-[95] flex animate-in items-start gap-3 overflow-hidden rounded-[14px] bg-note py-3 pr-2.5 pl-3.5 text-sm text-note-fg shadow-pop sm:inset-x-auto sm:right-5 sm:w-[400px] md:bottom-5"
    >
      <span className={`mt-px grid size-6 shrink-0 place-items-center rounded-full text-white ${k.className}`}>
        {k.icon}
        <span className="sr-only">{k.said}: </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-semibold">{t.message}</p>
        {t.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-note-sub">{t.detail}</p>}
        {(t.undo || steps.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {t.undo && (
              <button type="button" onClick={() => void undo()} disabled={busy} className={link}>
                {busy ? "Undoing…" : "Undo"}
              </button>
            )}
            {steps.map((a) =>
              a.href ? (
                <Link key={a.label} href={a.href} className={link} onClick={() => dismissToast(t.id)}>
                  {a.label}
                </Link>
              ) : (
                <button
                  key={a.label}
                  type="button"
                  className={link}
                  onClick={() => {
                    dismissToast(t.id);
                    a.run?.();
                  }}
                >
                  {a.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>
      <button onClick={() => dismissToast(t.id)} className="grid size-6 shrink-0 place-items-center rounded text-note-sub hover:text-note-fg" aria-label="Dismiss">
        <X className="size-4" aria-hidden />
      </button>
      {/* How long it has left: a thin line that runs out in the 5 seconds, standing still while held. */}
      <span aria-hidden className="absolute inset-x-3.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-note-fg/15">
        <span
          key={t.id}
          data-note-time=""
          className="block h-full origin-left rounded-full bg-note-link"
          style={{ animation: `note-time ${ms}ms linear forwards`, animationPlayState: held || busy ? "paused" : "running" }}
        />
      </span>
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
