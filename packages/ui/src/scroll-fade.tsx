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
  scrollLabel,
  ...props
}: {
  as?: "div" | "nav";
  className?: string;
  children: ReactNode;
  /**
   * What is in the box ("Items they asked for"). Given, the box takes the keyboard while it is wider than the
   * screen (focusable; arrow keys scroll it; a region with this name), so a table with no link in it can still be
   * read to its last column (WCAG 2.1.1). When it fits, it is no stop on the way through the page.
   */
  scrollLabel?: string;
} & Omit<ComponentProps<"div">, "ref" | "children">) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const more = el.scrollWidth - el.clientWidth > 2;
      el.toggleAttribute("data-fade-l", more && el.scrollLeft > 2);
      el.toggleAttribute("data-fade-r", more && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      if (scrollLabel) {
        if (more) {
          el.tabIndex = 0;
          el.setAttribute("role", "region");
          el.setAttribute("aria-label", scrollLabel);
        } else {
          el.removeAttribute("tabindex");
          el.removeAttribute("role");
          el.removeAttribute("aria-label");
        }
      }
    };
    const current = el.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
    if (current && el.scrollWidth > el.clientWidth) el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Without ResizeObserver (an old browser, a test's DOM) the box is judged once, when it is drawn.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [scrollLabel]);
  return (
    <Tag ref={ref as never} className={cn("scroll-fade", scrollLabel && "focus-visible:-outline-offset-2", className)} {...props}>
      {children}
    </Tag>
  );
}
