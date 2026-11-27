"use client";

import { useEffect, type RefObject } from "react";

/** Below the `sm` width (640 px): a phone. */
const PHONE = "(max-width: 639.98px)";

/** A column's name as its cells say it: the words of its head, without a sort arrow or a hidden note. */
const headWords = (th: Element) =>
  (th.textContent ?? "")
    .replace(/[▲▼↕]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A table on a phone (design system: "tables become rows"): when its columns do not fit the screen, each row
 * becomes a card instead of the table sliding sideways and cutting its last columns (review 26 Nov: "Sales USD
 * M…", "Time to first q…"). The row's first cell is its name, then one line per column: the column's name on the
 * left, the value on the right (theme.css, `table[data-stack]`). A table that fits stays a table; a laptop is never
 * changed. Each cell is given its column's name (`data-label`) from the table's head; a row added later is too.
 *
 * `box`: the box around the table (Table's Scroll, DataTable's box).
 */
export function usePhoneStack(box: RefObject<HTMLElement | null>, on = true) {
  useEffect(() => {
    const el = box.current;
    const table = el?.querySelector("table");
    if (!on || !el || !table || typeof window === "undefined" || !window.matchMedia) return;
    const phone = window.matchMedia(PHONE);
    const label = () => {
      const heads: string[] = [];
      for (const th of table.querySelectorAll(":scope > thead > tr:last-child > th")) {
        const span = (th as HTMLTableCellElement).colSpan || 1;
        for (let i = 0; i < span; i++) heads.push(i === 0 ? headWords(th) : "");
      }
      for (const tr of table.querySelectorAll(":scope > tbody > tr, :scope > tfoot > tr")) {
        let col = 0;
        for (const cell of tr.children) {
          const span = (cell as HTMLTableCellElement).colSpan || 1;
          // A cell that spans columns (a total's words, a note across the row) has no one column name.
          const name = span === 1 ? (heads[col] ?? "") : "";
          if (cell.getAttribute("data-label") !== name) cell.setAttribute("data-label", name);
          col += span;
        }
      }
    };
    const check = () => {
      if (!phone.matches) {
        table.removeAttribute("data-stack");
        return;
      }
      if (table.hasAttribute("data-stack")) return label();
      if (table.scrollWidth > el.clientWidth + 2) {
        label();
        table.setAttribute("data-stack", "");
      }
    };
    check();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    resized?.observe(el);
    // Rows drawn again (a filter, a page of results): their cells are named too.
    const changed = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => table.hasAttribute("data-stack") && label());
    changed?.observe(table, { childList: true, subtree: true });
    phone.addEventListener?.("change", check);
    return () => {
      resized?.disconnect();
      changed?.disconnect();
      phone.removeEventListener?.("change", check);
    };
  }, [box, on]);
}
