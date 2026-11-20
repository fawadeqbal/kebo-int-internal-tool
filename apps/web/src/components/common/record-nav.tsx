"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Old links to a record's tabs (?tab=orders) land on that section, now that
 * every section is on the page; and a one-time parameter (?saved=…, which
 * lights the card a save changed) leaves the URL after the 2-second highlight.
 */
export function RecordLanding({ section, clearParam = "saved" }: { section?: string | null; clearParam?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const once = params.get(clearParam);
  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(section);
    if (el) el.scrollIntoView({ block: "start" });
  }, [section]);
  useEffect(() => {
    if (!once) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      p.delete(clearParam);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 2200);
    return () => clearTimeout(t);
  }, [once, clearParam, pathname, router]);
  return null;
}
