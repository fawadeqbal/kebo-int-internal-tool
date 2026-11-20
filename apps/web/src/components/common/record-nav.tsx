"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PanelBody, UrlWindow } from "./panel";

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

/**
 * "All history" of a record, read-only in the side panel (?panel=history):
 * every change with who, when, old → new and the reason when one was asked.
 */
export function HistoryPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <UrlWindow name="history" title={title} description="Every change, newest first, with the reason when one was asked.">
      <PanelBody>{children}</PanelBody>
    </UrlWindow>
  );
}
