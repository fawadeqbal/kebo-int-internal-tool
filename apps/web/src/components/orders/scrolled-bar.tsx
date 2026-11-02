"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LinkTabs, cn } from "@kebo/ui";

export interface OrderTabLink {
  href: string;
  label: string;
  /** A short hint on the tab ("1 short", "USD 19,765 due"); alert makes it red. */
  hint?: string;
  alert?: boolean;
}

/** The order's tabs; each is its own address, so links, back and refresh land on the right one. */
export function OrderTabs({ base, tabs }: { base: string; tabs: OrderTabLink[] }) {
  const path = usePathname();
  return (
    <LinkTabs
      label="Order sections"
      className="mt-5"
      tabs={tabs.map((t) => ({
        href: t.href,
        active: t.href === base ? path === base : path.startsWith(t.href),
        label: (
          <span className="flex items-center gap-1.5">
            {t.label}
            {t.hint && (
              <span className={cn("rounded px-1.5 text-xs font-normal tabular", t.alert ? "bg-bad-soft text-bad" : "bg-surface-3 text-text-2")}>{t.hint}</span>
            )}
          </span>
        ),
      }))}
    />
  );
}

/**
 * The order's top (steps, Now bar, numbers) is long; once it has scrolled
 * away, a slim bar keeps the order number, its stage and what is needed now
 * in sight under the app's header.
 */
export function ScrolledBar({ children, bar }: { children: ReactNode; bar: ReactNode }) {
  const end = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAway(!e!.isIntersecting && e!.boundingClientRect.top < 0), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div className="no-print sticky top-14 z-10 h-0">
        <div
          aria-hidden={!away}
          className={cn(
            "absolute inset-x-0 top-0 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur-md transition-all sm:-mx-6 sm:px-6",
            away ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
          )}
        >
          {bar}
        </div>
      </div>
      {children}
      <div ref={end} aria-hidden />
    </>
  );
}
