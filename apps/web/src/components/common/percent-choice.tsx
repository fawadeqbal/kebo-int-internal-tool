"use client";

import { useState } from "react";
import { buttonClass, cn, controlClass } from "@kebo/ui";

/**
 * A percentage picked with quick chips (e.g. 13% / 9% / 3% / 0%) or typed in
 * a small "Other" box for any other rate. The value is the typed text, so the
 * API checks it like any other number.
 */
export function PercentChoice({
  id,
  label,
  value,
  onChange,
  choices,
  invalid,
  className,
}: {
  /** Id of the "Other" box (for a <label htmlFor>). */
  id: string;
  /** What the group is, for screen readers (e.g. "Tax added on top"). */
  label: string;
  value: string;
  onChange: (v: string) => void;
  choices: readonly { value: number; label?: string }[];
  invalid?: boolean;
  className?: string;
}) {
  const [typing, setTyping] = useState(false);
  const text = value.replace(/,/g, "").trim();
  const n = text === "" ? null : Number(text);
  const chosen = n !== null && Number.isFinite(n) ? choices.find((c) => c.value === n) : undefined;
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {choices.map((c) => {
        const on = chosen?.value === c.value && !typing;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(String(c.value))}
            className={cn(buttonClass("secondary", "sm"), "h-8 px-2.5 text-xs tabular", on && "border-primary/40 bg-primary-soft text-primary hover:bg-primary-soft", invalid && !chosen && "border-bad")}
          >
            {c.label ?? `${c.value}%`}
          </button>
        );
      })}
      <span className="relative inline-flex">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${label}: other %`}
          aria-invalid={invalid || undefined}
          placeholder="Other"
          value={typing || !chosen ? value : ""}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(controlClass, "h-8 w-20 pr-6 text-xs tabular", !chosen && text !== "" && !typing && "border-primary/40 bg-primary-soft text-primary")}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted">
          %
        </span>
      </span>
    </div>
  );
}
