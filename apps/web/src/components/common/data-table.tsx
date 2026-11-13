"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@kebo/ui";

/** Clicks on these do their own thing, not the row's. */
const OWN = "a,button,input,select,textarea,label,summary,[role=menu],[role=menuitem],[data-no-row]";

/**
 * A list's table (design system: List frame). Rows are DataRow: a click on a
 * row opens it, hover lights it, its first cell's link opens it from the
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
  /** For the table itself, e.g. the width below which it scrolls sideways (`min-w-[1000px]`). */
  tableClassName?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const once = clearParam ? params.get(clearParam) : null;

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
      className={cn(
        // Where every list fits its card (`fits`, see globals.css) the header row sticks under the app's top row
        // while the list scrolls; narrower, a wide table scrolls sideways instead of losing its last columns.
        "w-full overflow-x-auto fits:overflow-x-visible [&_thead_th]:bg-surface-2",
        "fits:[&_thead_th]:sticky fits:[&_thead_th]:top-14 fits:[&_thead_th]:z-[1]",
        className,
      )}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(OWN) || window.getSelection()?.toString()) return;
        const tr = target.closest<HTMLElement>("tr[data-href]");
        if (!tr || !box.current?.contains(tr)) return;
        const href = tr.dataset.href!;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
        else router.push(href);
      }}
    >
      <table aria-label={label} className={cn("w-full border-collapse text-sm", tableClassName)}>
        {children}
      </table>
    </div>
  );
}
