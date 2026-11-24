"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Input } from "@kebo/ui";

/**
 * A password box with Show / Hide on its right (the sign-in's, and now every one: review 24 Nov, a new person's first
 * password was shown as plain text with no way to hide it). Hidden at first.
 */
export function PasswordInput({ leading, className, ...props }: Omit<ComponentProps<typeof Input>, "type" | "unit"> & { leading?: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} leading={leading} type={shown ? "text" : "password"} spellCheck={false} className={["pr-16", className].filter(Boolean).join(" ")} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-1 right-1 rounded-md px-2.5 text-md font-semibold text-text-2 hover:bg-surface-2"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
