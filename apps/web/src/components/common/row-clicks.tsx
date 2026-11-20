"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Clicks on these do their own thing, not the row's. */
export const OWN_CLICK = "a,button,input,select,textarea,label,summary,[role=menu],[role=menuitem],[data-no-row]";

/**
 * The one rule for rows that open a record (DataRow, in any table): a click
 * anywhere on the row opens it, ⌘/Ctrl-click in a new tab. A click on a link,
 * a button, a field or the row's ⋯ does its own thing, and selecting text never
 * opens. The row's first link still opens it from the keyboard. Mounted once by
 * the app's frame, so no table carries its own copy of this.
 */
export function RowClicks() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest || target.closest(OWN_CLICK) || window.getSelection()?.toString()) return;
      const row = target.closest<HTMLElement>("tr[data-href]");
      if (!row) return;
      const href = row.dataset.href!;
      if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
      else router.push(href, { scroll: !row.hasAttribute("data-stay") });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
