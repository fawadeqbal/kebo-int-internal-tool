"use client";

import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "@kebo/ui";

/**
 * A choice of a few options as buttons (design rules 18 Nov: Came by, Priority, Company / Individual), not a
 * dropdown. A radio group for everyone: one stop for Tab, ← → (↑ ↓) move and choose, the chosen one ticked.
 */
export function ChoiceChips<T extends string>({
  id,
  label,
  labelledBy,
  value,
  options: givenOptions,
  labels: givenLabels,
  items,
  onChange,
  invalid,
  tones,
  disabled,
  className,
}: {
  id?: string;
  /** What the group is (read out): "Came by". Or labelledBy: the id of a label already on the page. */
  label?: string;
  labelledBy?: string;
  value: T | "";
  options?: readonly T[];
  labels?: Partial<Record<T, string>>;
  /** Instead of options and labels: { value, label } pairs. */
  items?: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  invalid?: boolean;
  /** A chosen result in its own colour (Pass green, Fail red). */
  tones?: Partial<Record<T, "ok" | "bad">>;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const options = items ? items.map((i) => i.value) : (givenOptions ?? []);
  const labels: Partial<Record<T, string>> = items ? (Object.fromEntries(items.map((i) => [i.value, i.label])) as Partial<Record<T, string>>) : (givenLabels ?? {});
  const at = Math.max(0, options.indexOf(value as T));
  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + options.length) % options.length;
    onChange(options[n]!);
    refs.current[n]?.focus();
  };
  return (
    <div id={id} role="radiogroup" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} aria-invalid={invalid || undefined} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o, i) => {
        const on = o === value;
        return (
          <button
            key={o}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === at ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text max-sm:h-10",
              on
                ? tones?.[o] === "bad"
                  ? "border-bad bg-bad-soft font-semibold text-bad"
                  : tones?.[o] === "ok"
                    ? "border-ok bg-ok-soft font-semibold text-ok"
                    : "border-primary bg-primary-soft font-semibold text-primary"
                : "border-line-strong bg-surface text-text hover:bg-surface-2",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {on && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

/** Quick reasons ("Why the change?"): the record's choices as choice buttons. A typed reason leaves none chosen. */
export function QuickReasons({ choices, value, onChange, label = "Quick reasons" }: { choices: readonly string[]; value: string; onChange: (v: string) => void; label?: string }) {
  if (!choices.length) return null;
  return <ChoiceChips label={label} value={choices.includes(value) ? value : ""} options={choices} onChange={onChange} />;
}
