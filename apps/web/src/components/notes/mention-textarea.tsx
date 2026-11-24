"use client";

import { useId, useRef, useState, type ComponentProps } from "react";
import { cn, Textarea } from "@kebo/ui";

type Person = { id: string; name: string };

/** The "@word" being typed just before the cursor, and where it starts; null when the cursor is not in one. */
function typedMention(text: string, at: number): { from: number; q: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(text.slice(0, at));
  return m ? { from: at - m[2]!.length - 1, q: m[2]!.toLowerCase() } : null;
}

/**
 * A note's box that suggests people while "@" and the first letters of a name are typed (review 24 Nov, O-34: "@San"
 * suggested no one): ↑ ↓ choose, Enter or Tab puts "@Full Name" in, Esc closes the list. The API tells the person
 * named, matching the whole name or its first word.
 */
export function MentionTextarea({ people, className, onKeyDown, ...props }: ComponentProps<typeof Textarea> & { people: Person[] }) {
  const listId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [typed, setTyped] = useState<{ from: number; q: string } | null>(null);
  const [active, setActive] = useState(0);
  const matches = typed
    ? people.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(typed.q)) || p.name.toLowerCase().startsWith(typed.q)).slice(0, 6)
    : [];
  const open = matches.length > 0;

  const look = () => {
    const el = box.current;
    if (!el) return;
    setTyped(typedMention(el.value, el.selectionStart ?? el.value.length));
    setActive(0);
  };
  const pick = (p: Person) => {
    const el = box.current;
    if (!el || !typed) return;
    const at = el.selectionStart ?? el.value.length;
    const next = `${el.value.slice(0, typed.from)}@${p.name} ${el.value.slice(at)}`;
    // Through the element's own setter, so the form and React see the new text as typed.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = typed.from + p.name.length + 2;
    el.setSelectionRange(caret, caret);
    el.focus();
    setTyped(null);
  };

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={box}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onInput={look}
        onClick={look}
        onBlur={() => setTimeout(() => setTyped(null), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
              return;
            }
            if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
              e.preventDefault();
              pick(matches[active]!);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setTyped(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="People to mention" className="absolute top-full left-0 z-30 mt-1 w-64 max-w-full rounded-lg border border-line bg-surface p-1 shadow-pop">
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={cn("cursor-pointer rounded-md px-2.5 py-1.5 text-sm", i === active ? "bg-surface-2 text-text" : "text-text-2")}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
