"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn, controlClass, controlSizes } from "@kebo/ui";
import { FloatingList } from "@/components/common/floating";

export interface PickOption {
  value: string;
  label: string;
}

/**
 * The one way to choose from a list longer than a few (rule 15: past 8 choices a list gets a box to type in):
 * a box that filters the list under it as you type, Down to go into it, Enter to take one, Esc to close.
 * `free`: what is typed is the value (a port, a town); else only a choice from the list is kept (a country:
 * its code goes in the form under `name`, the box shows its name, and leaving the box puts back the last choice).
 */
export function TypeToPick({
  id,
  name,
  options,
  value,
  onChange,
  free = false,
  listLabel,
  maxLength = 60,
  invalid,
  className,
}: {
  id: string;
  name?: string;
  options: PickOption[];
  value: string;
  onChange: (value: string) => void;
  free?: boolean;
  listLabel: string;
  maxLength?: number;
  invalid?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // What is typed while searching (strict lists only; a free one types its value).
  const [typing, setTyping] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const text = free ? value : (typing ?? labelOf(value));
  const q = text.trim().toLowerCase();
  const exact = options.some((o) => o.label.toLowerCase() === q);
  // Searching shows what matches; just opened (or showing the choice) shows all.
  const searching = free ? !!q && !exact : typing !== null && !!q;
  const shown = searching ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q) : options;
  const take = (o: PickOption) => {
    onChange(o.value);
    setTyping(null);
    setOpen(false);
  };
  const input = () => document.getElementById(id)?.focus();
  return (
    <div ref={box} className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <input
        id={id}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={text}
        maxLength={maxLength}
        className={cn(controlClass, controlSizes.md, "pr-9")}
        onFocus={(e) => {
          if (!free) e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => {
          // A strict list keeps only a choice: what was typed and not taken goes back to the choice.
          if (!free) setTyping(null);
        }}
        onChange={(e) => {
          if (free) onChange(e.target.value);
          else setTyping(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && !free && open && shown.length > 0) {
            e.preventDefault();
            take(shown[0]!);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            document.querySelector<HTMLElement>(`#${CSS.escape(id)}-list [role=option]`)?.focus();
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Show ${listLabel.toLowerCase()}`}
        className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-text pointer-coarse:size-10"
        onClick={() => {
          setOpen((o) => !o);
          input();
        }}
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open && shown.length > 0 && (
        <FloatingList anchor={() => box.current} onClose={() => setOpen(false)} className="p-1">
          <ul id={`${id}-list`} role="listbox" aria-label={listLabel} className="max-h-60 overflow-y-auto">
            {shown.map((o) => {
              const on = free ? o.label.toLowerCase() === q : o.value === value;
              return (
                <li
                  key={o.value}
                  role="option"
                  tabIndex={-1}
                  aria-selected={on}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    take(o);
                  }}
                  onKeyDown={(e) => {
                    const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
                    const at = items.indexOf(e.currentTarget);
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      items[at + 1]?.focus();
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (at === 0) input();
                      else items[at - 1]?.focus();
                    } else if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      take(o);
                      input();
                    } else if (e.key === "Escape") {
                      setOpen(false);
                      input();
                    }
                  }}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none hover:bg-surface-2 focus:bg-surface-2",
                    on && "bg-primary-soft font-medium text-primary",
                  )}
                >
                  {o.label}
                </li>
              );
            })}
          </ul>
        </FloatingList>
      )}
    </div>
  );
}
