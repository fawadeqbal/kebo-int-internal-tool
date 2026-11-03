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
 * stays in view while the page scrolls (from 1280px up; on smaller screens
 * a wide table scrolls sideways instead). Not for tables of lines you edit
 * (LineTable).
 *
 * `clearParam`: a parameter that only lights a row once (?saved=…), taken out
 * of the URL after the 2-second highlight.
 */
export function DataTable({ label, children, clearParam, className }: { label: string; children: ReactNode; clearParam?: string; className?: string }) {
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
        "w-full overflow-x-auto xl:overflow-x-visible",
        // The header row sticks under the app's top bar while the list scrolls (from 1280px, where every list fits;
        // narrower, a wide table scrolls sideways instead of losing its last columns).
        "xl:[&_thead_th]:sticky xl:[&_thead_th]:top-14 xl:[&_thead_th]:z-[1] [&_thead_th]:bg-surface-2",
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
      <table aria-label={label} className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}
