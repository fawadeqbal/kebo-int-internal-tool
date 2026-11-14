"use client";

import { useMemo, useRef, type RefObject } from "react";

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * What the fields inside a window hold right now, as one text: typed text, ticks, choices, chosen files
 * and hidden values (a line table, a picture). Two of these are compared to tell whether anything changed.
 */
export function fieldValues(box: HTMLElement): string {
  const out: string[] = [];
  for (const el of box.querySelectorAll<FieldEl>("input, select, textarea")) {
    let value: string;
    if (el instanceof HTMLInputElement) {
      // Buttons hold nothing; a search box only looks things up.
      if (["button", "submit", "reset", "image", "search"].includes(el.type)) continue;
      if (el.type === "checkbox" || el.type === "radio") value = `${el.value}:${el.checked ? 1 : 0}`;
      else if (el.type === "file") value = [...(el.files ?? [])].map((f) => `${f.name}/${f.size}`).join(",");
      else value = el.value;
    } else if (el instanceof HTMLSelectElement && el.multiple) value = [...el.selectedOptions].map((o) => o.value).join(",");
    else value = el.value;
    out.push(`${el.name || el.id}\u0001${value}`);
  }
  return out.join("\u0002");
}

/**
 * Whether the person changed anything in a window (the one rule for every window that edits):
 *
 * - What the window started with is what its fields hold at the person's first key, press, paste or drop in
 *   it (taken before that changes anything). So whatever the form filled in by itself before that — a
 *   default, a value that arrives a moment after it opens, a field that announces itself — is not a change.
 * - `changed()` compares the fields now with that start. Typed and put back as it was: nothing changed.
 * - `saved()` after a save that keeps the window open: what is there now is the new start.
 *
 * (When a field changes with no key or press before it — filled in by a tool — the start is what the fields
 * held when focus first came into the window.)
 */
export function useChanges(box: RefObject<HTMLElement | null>) {
  const state = useRef<{ start: string | null; fixed: boolean; filled: boolean }>({ start: null, fixed: false, filled: false });
  return useMemo(() => {
    const now = () => (box.current ? fieldValues(box.current) : null);
    return {
      /** Focus came in: a first start, until the person does something. */
      focus: () => {
        const s = state.current;
        if (s.start === null) s.start = now();
      },
      /** The person's first key, press, paste or drop: the start is fixed here. */
      begin: () => {
        const s = state.current;
        if (s.fixed) return;
        if (s.start === null || !s.filled) s.start = now();
        s.fixed = true;
      },
      /** A field changed before any key or press: the start stays what focus found. */
      filled: () => {
        const s = state.current;
        if (s.start !== null && !s.fixed) s.filled = true;
      },
      changed: () => {
        const s = state.current;
        return s.start !== null && now() !== s.start;
      },
      saved: () => {
        state.current = { start: null, fixed: false, filled: false };
      },
    };
  }, [box]);
}

/** The props that tell a window's `useChanges` what the person does (spread on the window's box). */
export const watchChanges = (c: { focus: () => void; begin: () => void; filled: () => void }) => ({
  onFocusCapture: c.focus,
  onPointerDownCapture: c.begin,
  onKeyDownCapture: c.begin,
  onBeforeInputCapture: c.begin,
  onPasteCapture: c.begin,
  onDropCapture: c.begin,
  onInputCapture: c.filled,
  onChangeCapture: c.filled,
});
