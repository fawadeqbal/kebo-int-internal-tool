"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn, tableClass } from "@kebo/ui";

/**
 * A list's table (design system: List frame). Rows are DataRow: a click on a
 * row opens it (RowClicks, mounted by the app's frame), hover lights it, its first cell's link opens it from the
 * keyboard (Enter), and its ⋯ (RowMenu) sits in the last cell. The header
 * stays in view while the page scrolls (where the list fits; on a narrower
 * page a wide table scrolls sideways instead). Not for tables of lines you edit
 * (LineTable). This is the <table>: give it <thead>/<tbody>, never another table.
 *
 * `clearParam`: a parameter that only lights a row once (?saved=…), taken out
 * of the URL after the 2-second highlight.
 */
export function DataTable({
  label,
  children,
  clearParam,
  className,
  tableClassName,
}: {
  label: string;
  children: ReactNode;
  clearParam?: string;
  className?: string;
  /** For the table itself (its text size). No table sets a width: columns that do not fit wrap. */
  tableClassName?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const once = clearParam ? params.get(clearParam) : null;
  // Wider than its card (a phone, a narrow window), the list scrolls sideways: then its box takes the keyboard
  // (arrow keys scroll it), as the design system's Table does. A list with no link in it (a ledger) had no other
  // way in. Where it fits, the box is not a stop on the way through the page.
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    const watch = new ResizeObserver(check);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    check();
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (!clearParam || !once) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      p.delete(clearParam);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 2200);
    return () => clearTimeout(t);
  }, [clearParam, once, pathname, router]);

  return (
    <div
      ref={box}
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      className={cn(
        // Where every list fits its card (`fits`, see globals.css) the header row sticks under the app's top row
        // while the list scrolls; narrower, a wide table scrolls sideways instead of losing its last columns.
        // relative: a hidden (sr-only) label in a cell is placed inside the scrolling box, never past the screen's edge.
        "relative w-full overflow-x-auto fits:overflow-x-visible [&_thead_th]:bg-faint",
        "fits:[&_thead_th]:sticky fits:[&_thead_th]:top-14 fits:[&_thead_th]:z-[1] focus-visible:-outline-offset-2",
        className,
      )}
    >
      <table aria-label={label} className={cn(tableClass, tableClassName)}>
        {children}
      </table>
    </div>
  );
}
