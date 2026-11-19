import type { ComponentProps } from "react";
import { cn, controlClass, controlSizes, type ControlSize } from "@kebo/ui";

/**
 * An amount box that always shows its currency (USD, CNY, PKR) inside it, so
 * nobody types a number without seeing which money it is.
 */
export function MoneyInput({
  currency,
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"input">, "type" | "size"> & { currency: string; size?: ControlSize }) {
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-semibold tracking-wide text-muted"
        aria-hidden
      >
        {currency || "—"}
      </span>
      <input inputMode="decimal" autoComplete="off" className={cn(controlClass, controlSizes[size], "pl-12 tabular", className)} {...props} />
    </div>
  );
}
