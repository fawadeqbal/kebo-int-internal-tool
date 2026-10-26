"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
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

/** Shows a short confirmation after a redirect (?toast=…), then cleans the URL. */
export function Toast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const message = params.get("toast");
  const [visible, setVisible] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  // Show a newly arrived message (state adjusted during render, not in an effect).
  if (message && message !== lastMessage) {
    setLastMessage(message);
    setVisible(message);
  }

  useEffect(() => {
    if (!message) return;
    const next = new URLSearchParams(params.toString());
    next.delete("toast");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    const timer = setTimeout(() => setVisible(null), 4000);
    return () => clearTimeout(timer);
  }, [message, params, pathname, router]);

  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-4 bottom-24 z-50 flex animate-in items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-text shadow-pop sm:inset-x-auto sm:right-5 sm:min-w-72 lg:bottom-5"
    >
      <span className="flex size-5 items-center justify-center rounded-full bg-ok-soft text-ok" aria-hidden>
        <svg viewBox="0 0 16 16" className="size-3" fill="none"><path d="m4 8.5 2.5 2.5L12 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="flex-1">{visible}</span>
      <button onClick={() => setVisible(null)} className="ml-2 rounded p-0.5 text-muted hover:text-text" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

/** A filter select that applies itself as soon as it changes. */
export function AutoSelect(props: ComponentProps<typeof Select>) {
  return <Select compact {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
