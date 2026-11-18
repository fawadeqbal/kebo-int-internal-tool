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
 *
 * The values are kept only while something is typed in: with nothing to type in there is no keyboard, and the
 * windows fill the screen (100dvh). (Safari on an iPhone can leave the last keyboard-open height and offset in
 * place after the keyboard goes, which left a window as a band in the middle of the screen; the values are read
 * again once the keyboard has finished moving.)
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
        const typing = typesHere(document.activeElement);
        if (typing) {
          root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
          root.style.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
        } else {
          root.style.removeProperty("--vvh");
          root.style.removeProperty("--vvt");
        }
        const now = typing && vv.height < tallest - 120;
        if (now) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
        if (now && !open) setTimeout(bring, 60);
        open = now;
      });
    };
    // The keyboard takes a moment to open or close: read the screen again once it has.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      update();
      timers.splice(0).forEach(clearTimeout);
      timers.push(setTimeout(update, 350), setTimeout(update, 800));
    };
    // Moving to another box with the keyboard up: that box comes into view too.
    const focused = () => {
      if (open) setTimeout(bring, 120);
      settle();
    };
    update();
    vv.addEventListener("resize", settle);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", focused);
    document.addEventListener("focusout", settle);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      vv.removeEventListener("resize", settle);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", focused);
      document.removeEventListener("focusout", settle);
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
