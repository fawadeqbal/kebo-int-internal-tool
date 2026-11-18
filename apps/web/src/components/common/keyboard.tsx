"use client";

import { useEffect } from "react";

/** Where the keyboard goes: a box to type in (not a tick box or a button), a text area, a dropdown, editable text. */
function typesHere(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"].includes(el.type);
}

/**
 * Typing on a phone (design 18 Nov, "Typing on a phone"): an iPhone does not make the page shorter when the
 * keyboard opens — it slides the whole page up, and a window's title and buttons go off the screen. This keeps
 * the part of the screen above the keyboard in two CSS values, --vvh (its height) and --vvt (how far down it
 * starts), which every full-screen window, sheet and confirm on a phone follows (FIT_VIEW). With the keyboard
 * open the page says so (data-keyboard="open"): a tall box gets shorter and the steps bar tighter, and the box
 * being typed in is brought into view between the window's title and its buttons.
 */
export function KeyboardWatch() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let width = vv.width;
    let tallest = vv.height;
    let open = false;
    let frame = 0;
    const bring = () => {
      const el = document.activeElement;
      if (typesHere(el)) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Turned round (or a new window size): the screen's full height starts again.
        if (Math.abs(vv.width - width) > 1) {
          width = vv.width;
          tallest = vv.height;
        }
        tallest = Math.max(tallest, vv.height);
        root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
        root.style.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
        const now = typesHere(document.activeElement) && vv.height < tallest - 120;
        if (now) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
        if (now && !open) setTimeout(bring, 60);
        open = now;
      });
    };
    // Moving to another box with the keyboard up: that box comes into view too.
    const focused = () => {
      if (open) setTimeout(bring, 120);
      update();
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", focused);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", focused);
      document.removeEventListener("focusout", update);
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
