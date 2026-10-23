"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buttonClass } from "./index";

/** Submit button that shows progress and blocks double submits. */
export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} aria-busy={pending} className={buttonClass(variant, size, className)} {...props}>
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
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
      className="no-print fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-lg"
    >
      <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
      {visible}
      <button onClick={() => setVisible(null)} className="ml-2 text-white/60 hover:text-white" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary", "md")}>
      {label}
    </button>
  );
}
