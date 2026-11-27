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
/** How long the page it went back to may take to draw the link (its loading shape shows first). */
const LOOK_MS = 8_000;

const here = () => `${window.location.pathname}${window.location.search}`;
/** An address read as the browser would (a relative link, `back` with or without its query); null: not one. */
const urlOf = (v: string): URL | null => {
  try {
    return new URL(v, window.location.origin);
  } catch {
    return null;
  }
};
const same = (a: string, b: string) => {
  const x = urlOf(a);
  const y = urlOf(b);
  return !!x && !!y && x.pathname === y.pathname && x.search === y.search;
};
/** Seen on the page (not in a hidden copy for another screen size): focus() on it does something. */
const shown = (el: HTMLElement) => el.getClientRects().length > 0;
/** Nothing has the focus yet: the new page's start. Something the person moved to since is left alone. */
const focusFree = () => !document.activeElement || document.activeElement === document.body;

/**
 * The link to the window's address; else (a paper uploaded in the window: its link now says which file) a link
 * to the same document, the same address without its query's file.
 */
function linkTo(opener: string): HTMLAnchorElement | null {
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(shown);
  const exact = links.find((a) => same(a.href, opener));
  if (exact) return exact;
  const want = urlOf(opener);
  if (!want) return null;
  const sameDoc = (u: URL | null) => {
    if (!u || u.pathname !== want.pathname) return false;
    const q = new URLSearchParams(u.search);
    q.delete("doc");
    const w = new URLSearchParams(want.search);
    w.delete("doc");
    return q.toString() === w.toString();
  };
  return links.find((a) => sameDoc(urlOf(a.href))) ?? null;
}

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
    // The list may draw a while after the address changes: look for the link until it is there, for a few seconds,
    // and only while nothing else has the focus (the person may have gone on with the keyboard meanwhile).
    const until = Date.now() + LOOK_MS;
    let frame = 0;
    const look = () => {
      if (!focusFree()) return;
      const link = linkTo(opener);
      if (link) link.focus();
      else if (Date.now() < until) frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [path]);
  return null;
}
