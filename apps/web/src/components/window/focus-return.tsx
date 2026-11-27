"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * The focus back on what opened a window that is a page of its own (an order's document opened from the
 * Documents list: /orders/:id/papers/:kind). Closing it goes to the page it came from, and a new page starts the
 * focus at its top; a keyboard user lost their place in the list (review 27 Nov, the one gap left in
 * windows-flows.spec.ts). The window notes its own address as it closes (`rememberOpener`); when the page it goes
 * back to shows, the link to that address gets the focus.
 */
const KEY = "kebo-focus-return";
type Note = { back: string; opener: string; at: number };
/** Longer than any page takes to come back; a note older than this is from another visit. */
const FRESH_MS = 15_000;

const here = () => `${window.location.pathname}${window.location.search}`;
/** An address as the browser writes it (a relative link, or `back` with or without its query). */
const same = (a: string, b: string) => {
  const base = window.location.origin;
  const x = new URL(a, base);
  const y = new URL(b, base);
  return x.pathname === y.pathname && x.search === y.search;
};

/** Called as the window closes, before going `back`: the window's address is the link that opened it. */
export function rememberOpener(back: string) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ back, opener: here(), at: Date.now() }));
  } catch {
    // Storage refused (a private window, a full store): the focus starts at the top, as before.
  }
}

/** In the app's frame: gives the focus back once the page the window went back to is there. */
export function FocusReturn() {
  const path = usePathname();
  useEffect(() => {
    let note: Note | null;
    try {
      const raw = window.sessionStorage.getItem(KEY);
      note = raw ? (JSON.parse(raw) as Note) : null;
    } catch {
      return;
    }
    if (!note) return;
    if (Date.now() - note.at > FRESH_MS) {
      window.sessionStorage.removeItem(KEY);
      return;
    }
    // Still on the window's page (the close is on its way): wait for the next page.
    if (!same(here(), note.back)) return;
    window.sessionStorage.removeItem(KEY);
    const { opener } = note;
    // The list may draw a moment after the address changes: look for the link for a few frames.
    let tries = 0;
    let frame = 0;
    const look = () => {
      const link = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find((a) => same(a.getAttribute("href") ?? "", opener));
      if (link) link.focus();
      else if (++tries < 120) frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [path]);
  return null;
}
