"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@kebo/ui";
import { SidePanel, PanelBody, useSidePanel } from "./panel";

export interface RecordNavItem {
  /** The RecordSection's id. */
  id: string;
  label: string;
  count?: number;
}

/**
 * A record page's sections on a phone (design system: sections become chips):
 * a row of chips that scrolls sideways, the section in view filled. A chip
 * scrolls to its section. Wider screens show every section without it.
 */
export function RecordNav({ label, items }: { label: string; items: RecordNavItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setCurrent(seen.target.id);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav aria-label={label} className="no-print sticky top-14 z-[5] -mx-4 mb-4 bg-bg/95 px-4 py-1.5 backdrop-blur md:hidden">
      <ul className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              aria-current={current === i.id ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setCurrent(i.id);
                document.getElementById(i.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
                current === i.id
                  ? "border-primary/40 bg-primary-soft font-semibold text-primary"
                  : "border-line bg-surface text-text-2 hover:text-text",
              )}
            >
              {i.label}
              {i.count !== undefined && <span className="tabular opacity-80">{i.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

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
  const panel = useSidePanel("history");
  if (!panel.open) return null;
  return (
    <SidePanel title={title} description="Every change, newest first, with the reason when one was asked." onClose={() => panel.close()}>
      <PanelBody>{children}</PanelBody>
    </SidePanel>
  );
}
