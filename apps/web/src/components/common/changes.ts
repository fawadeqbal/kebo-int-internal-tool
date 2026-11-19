"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { countChanges } from "./change-words";

type FieldEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * What the fields inside a window hold right now, as one text: typed text, ticks, choices, chosen files
 * and hidden values (a line table, a picture). Two of these are compared to tell whether anything changed.
 */
export function fieldValues(box: HTMLElement): string {
  const out: string[] = [];
  for (const el of box.querySelectorAll<FieldEl>("input, select, textarea")) {
    // A picker that only moves to another record (Which order) holds nothing to lose.
    if (el.closest("[data-no-change]")) continue;
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

/** Each named field's value now (name → value), read the way `fieldValues` reads them. */
export function valuesByName(box: HTMLElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of fieldValues(box).split("\u0002")) {
    if (!part) continue;
    const [name, value = ""] = part.split("\u0001");
    if (!name) continue;
    // A radio group or several ticks under one name: their values together.
    out.set(name, out.has(name) ? `${out.get(name)}|${value}` : value);
  }
  return out;
}

/**
 * How many of a window's fields differ from what it opened with, as it is typed — changed (or removed) and added
 * apart, for changeWords ("No changes", "Save", "Save 2 changes"): the start is taken once the window is drawn; `recount` after each input
 * (a moment later, so values that follow a field — a hidden one kept in state — are counted too).
 */
export function useChangeCount(box: RefObject<HTMLElement | null>) {
  const start = useRef<Map<string, string> | null>(null);
  const [counts, setCounts] = useState({ changed: 0, added: 0 });
  useEffect(() => {
    const t = setTimeout(() => {
      if (box.current) start.current = valuesByName(box.current);
    }, 0);
    return () => clearTimeout(t);
  }, [box]);
  const recount = useCallback(() => {
    setTimeout(() => {
      if (!box.current || !start.current) return;
      const now = valuesByName(box.current);
      const was = start.current;
      // Added (an empty field filled) is not a change (canvas group 9): it is counted apart.
      const next = countChanges([...new Set([...was.keys(), ...now.keys()])].map((k) => ({ from: was.get(k) ?? "", to: now.get(k) ?? "" })));
      setCounts((c) => (c.changed === next.changed && c.added === next.added ? c : next));
    }, 0);
  }, [box]);
  return { ...counts, recount };
}
