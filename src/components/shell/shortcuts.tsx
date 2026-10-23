"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keyboard shortcuts: "/" focuses the search box on list pages, "n" starts a new query. */
export function KeyboardShortcuts({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "/") {
        const search = document.getElementById("search") as HTMLInputElement | null;
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      } else if (e.key === "n" && canCreate) {
        e.preventDefault();
        router.push("/queries/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, canCreate]);
  return null;
}
