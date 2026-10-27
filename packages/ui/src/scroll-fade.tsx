"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * A row that scrolls sideways (tabs, a wide table). The edge with more to see
 * fades out, so on a phone it is clear there is more to swipe to; the selected
 * tab is brought into view when the page opens. The fade is set straight on
 * the element (data-fade-l / data-fade-r), so scrolling never re-renders.
 */
export function ScrollFade({
  as: Tag = "div",
  className,
  children,
  ...props
}: { as?: "div" | "nav"; className?: string; children: ReactNode } & Omit<ComponentProps<"div">, "ref" | "children">) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const more = el.scrollWidth - el.clientWidth > 2;
      el.toggleAttribute("data-fade-l", more && el.scrollLeft > 2);
      el.toggleAttribute("data-fade-r", more && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    const current = el.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
    if (current && el.scrollWidth > el.clientWidth) el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return (
    <Tag ref={ref as never} className={cn("scroll-fade", className)} {...props}>
      {children}
    </Tag>
  );
}
