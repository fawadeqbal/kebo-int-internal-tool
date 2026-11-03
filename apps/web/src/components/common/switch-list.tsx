"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import type { ActionState } from "@/lib/actions";

/** An on/off switch: a real button (role=switch) that says what it is and whether it is on. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** For screen readers: what it switches ("Daily summary"). */
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50",
        checked ? "bg-primary-solid" : "bg-surface-3",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow-card transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export interface SwitchItem {
  key: string;
  label: string;
  hint?: ReactNode;
  on: boolean;
  /** Cannot be switched here (e.g. by plan); the reason shows as its hint. */
  disabled?: boolean;
}

/**
 * A list of on/off rows (design system: switch list in a settings card): each
 * switch saves as soon as it is switched — no Save button — with a short
 * "Saved" note, and goes back if the save fails. `save` gets the row and its
 * new value and returns the action's state.
 */
export function SwitchList({
  items,
  save,
  label,
  className,
}: {
  items: SwitchItem[];
  save: (key: string, on: boolean) => Promise<ActionState>;
  /** The list's name for screen readers. */
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.key, i.on])));
  const flip = (item: SwitchItem, on: boolean) => {
    setState((s) => ({ ...s, [item.key]: on }));
    start(async () => {
      const r = await save(item.key, on);
      if (r.ok === false) {
        setState((s) => ({ ...s, [item.key]: !on }));
        toast(r.message ?? "Could not save that. Try again.");
        return;
      }
      toast(`Saved · ${item.label} ${on ? "on" : "off"}`);
      router.refresh();
    });
  };
  return (
    <ul aria-label={label} aria-busy={pending || undefined} className={cn("flex flex-col divide-y divide-line", className)}>
      {items.map((i) => {
        const on = state[i.key] ?? i.on;
        const id = `switch-${i.key}`;
        return (
          <li key={i.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <label htmlFor={id} className="min-w-0 cursor-pointer">
              <span className={cn("block text-sm font-medium", !on && "text-text-2")}>{i.label}</span>
              {i.hint && <span className="block text-xs text-muted">{i.hint}</span>}
            </label>
            <span className="flex shrink-0 items-center gap-2">
              <span className={cn("text-xs", on ? "text-ok" : "text-muted")} aria-hidden>
                {on ? "On" : "Off"}
              </span>
              <Switch id={id} checked={on} disabled={i.disabled} label={`${i.label}: ${on ? "on" : "off"}`} onChange={(next) => flip(i, next)} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
