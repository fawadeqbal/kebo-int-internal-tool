"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";
import { usePhoneStack } from "./phone-stack";

/**
 * Scroll — the one scroll bar (canvas "Scroll: one scroll bar for the whole app", 21 Nov). Every box that scrolls is
 * this piece: a thin rounded thumb over the content, no track, hidden at rest; it shows on hover and while
 * scrolling and fades 800 ms after; it grows on hover and takes the brand colour while dragged (theme.css,
 * `.scroll`). A phone keeps its own thin bar while you swipe.
 *
 *   size  sm 4px (menus, the side panel) · md 6px (the default: a dialog, a sheet, a box) · lg 8px (wide tables,
 *         grids) · none (chips and tab rows: no bar ever)
 *   axis  y (the default) · x · both
 *   fade  the edge with more to see fades out
 *   label what is in it: while it scrolls it takes the keyboard (a region with that name, arrow keys scroll it)
 *   stack a table in it becomes one card per row on a phone when its columns do not fit (usePhoneStack)
 *
 * A test (one-of-each) keeps scroll-xy / scroll-x / scroll-y out of every other file.
 */
export type ScrollSize = "sm" | "md" | "lg" | "none";

export function Scroll({
  as: Tag = "div",
  axis = "y",
  size = "md",
  fade = false,
  label,
  stack = false,
  className,
  children,
  ...props
}: {
  as?: "div" | "nav" | "ul" | "ol" | "section" | "aside" | "main" | "pre" | "dl" | "tbody";
  axis?: "x" | "y" | "both";
  size?: ScrollSize;
  fade?: boolean;
  label?: string;
  stack?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"div">, "ref" | "children">) {
  const ref = useRef<HTMLElement>(null);
  usePhoneStack(ref, stack);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const x = el.scrollWidth - el.clientWidth > 2;
      const y = el.scrollHeight - el.clientHeight > 2;
      if (fade) {
        el.toggleAttribute("data-fade-l", x && axis !== "y" && el.scrollLeft > 2);
        el.toggleAttribute("data-fade-r", x && axis !== "y" && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
        el.toggleAttribute("data-fade-t", y && axis !== "x" && el.scrollTop > 2);
        el.toggleAttribute("data-fade-b", y && axis !== "x" && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
      }
      if (label) {
        const more = (axis !== "y" && x) || (axis !== "x" && y);
        if (more) {
          el.tabIndex = 0;
          el.setAttribute("role", "region");
          el.setAttribute("aria-label", label);
        } else {
          el.removeAttribute("tabindex");
          el.removeAttribute("role");
          el.removeAttribute("aria-label");
        }
      }
    };
    const scrolled = () => {
      update();
      el.setAttribute("data-scrolling", "");
      clearTimeout(idle);
      idle = setTimeout(() => el.removeAttribute("data-scrolling"), 800);
    };
    // The chosen tab or chip is brought into view when the row opens.
    if (axis !== "y") {
      const current = el.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
      if (current && el.scrollWidth > el.clientWidth) el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    }
    update();
    el.addEventListener("scroll", scrolled, { passive: true });
    // Without ResizeObserver (an old browser, a test's DOM) the box is judged once, when it is drawn.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", scrolled);
      clearTimeout(idle);
      ro?.disconnect();
    };
  }, [axis, fade, label]);
  const Box = Tag as "div";
  return (
    // relative: what is placed inside it (a screen reader's hidden words) stays inside it, so a wide table scrolls
    // in its box and never widens the page (a phone would zoom out).
    <Box
      ref={ref as never}
      className={cn(
        "scroll relative",
        // A row that slides sideways never scrolls up and down too (a tab's underline would make it).
        axis === "x" ? "scroll-x overflow-y-hidden" : axis === "y" ? "scroll-y" : "scroll-xy",
        size === "sm" ? "scroll-sm" : size === "lg" ? "scroll-lg" : size === "none" ? "scroll-none" : null,
        label && "focus-visible:-outline-offset-2",
        className,
      )}
      {...props}
    >
      {children}
    </Box>
  );
}
