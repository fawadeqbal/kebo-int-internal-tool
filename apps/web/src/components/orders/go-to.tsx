"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * Checklist links (board Fix25Links): a checklist item's chip scrolls to where
 * its data lives and lights it up for two seconds — the card outlined, the
 * values with a soft background. Places are marked with
 * `data-target="shipment.containerNo"` (a card: one word, plus
 * `data-target-card`); the names come from itemLink in @kebo/shared. A link
 * to another step carries them in the address: `#goto=shipment.containerNo,…`.
 */

const HOLD = 2000;
const HASH = "#goto=";

const shown = (el: Element) => el.getClientRects().length > 0;
const marked = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-target="${CSS.escape(name)}"]`)].filter(shown);

/** The rows of a card's tables whose text starts with `name` ("deposit" → "Deposit 30%"). */
function rowsOf(card: HTMLElement, name: string): HTMLElement[] {
  const want = name.toLowerCase();
  return [...card.querySelectorAll<HTMLElement>("tbody tr")].filter((tr) => {
    if (!shown(tr)) return false;
    const cells = [...tr.children].map((c) => (c.textContent ?? "").trim().toLowerCase());
    return cells.slice(0, 3).some((t) => t.startsWith(want));
  });
}

/**
 * The places on this page for some targets: each exact one, else the row of
 * its card named by the rest, else the nearest card it has. Empty: none here.
 */
export function findTargets(targets: string[]): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const t of targets) {
    const exact = marked(t);
    if (exact.length) {
      exact.forEach((el) => out.add(el));
      continue;
    }
    const parts = t.split(".");
    for (let n = parts.length - 1; n > 0; n--) {
      const cards = marked(parts.slice(0, n).join("."));
      if (!cards.length) continue;
      const rest = parts.slice(n).join(" ");
      const rows = cards.flatMap((c) => rowsOf(c, rest));
      (rows.length ? rows : cards).forEach((el) => out.add(el));
      break;
    }
  }
  return [...out];
}

/** Keeps the person told what lit up (screen readers). */
function announce(text: string) {
  let live = document.getElementById("goto-live");
  if (!live) {
    live = document.createElement("p");
    live.id = "goto-live";
    live.setAttribute("aria-live", "polite");
    live.className = "sr-only";
    document.body.appendChild(live);
  }
  live.textContent = "";
  window.setTimeout(() => (live!.textContent = text), 50);
}

/**
 * Scrolls to the places of `targets` on this page and lights them up for two
 * seconds; the card takes the focus, so the jump is announced. False when the
 * page has none of them.
 */
export function goTo(targets: string[], label?: string): boolean {
  const found = findTargets(targets);
  if (!found.length) return false;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const first = found[0]!;
  first.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  const cards = new Set<HTMLElement>();
  const hits: HTMLElement[] = [];
  for (const el of found) {
    if (el.hasAttribute("data-target-card")) cards.add(el);
    else {
      hits.push(el);
      const card = el.closest<HTMLElement>("[data-target-card]");
      if (card) cards.add(card);
    }
  }
  const all = [...cards, ...hits];
  for (const el of all) el.classList.remove("goto-card", "goto-hit");
  // Again from the start when the same link is clicked twice.
  void first.offsetWidth;
  cards.forEach((el) => el.classList.add("goto-card"));
  hits.forEach((el) => el.classList.add("goto-hit"));
  window.setTimeout(() => all.forEach((el) => el.classList.remove("goto-card", "goto-hit")), HOLD);
  const focus = first.closest<HTMLElement>("[data-target-card]") ?? first;
  if (!focus.hasAttribute("tabindex")) focus.setAttribute("tabindex", "-1");
  focus.focus({ preventScroll: true });
  if (label) announce(`Showing ${label}`);
  return true;
}

/** The address of a link to another step that lands on these places. */
export const goToHash = (targets: string[]) => `${HASH}${targets.map(encodeURIComponent).join(",")}`;

/**
 * On a step page: when the address carries `#goto=…` (a checklist link from
 * another step), lights those places up once the page is there, then drops
 * the hash so a reload does not do it again.
 */
export function GoToOnLoad() {
  useEffect(() => {
    const run = () => {
      const h = window.location.hash;
      if (!h.startsWith(HASH)) return;
      const targets = h.slice(HASH.length).split(",").map(decodeURIComponent).filter(Boolean);
      // After the page has laid out (and the browser's own jump to the top).
      const t = window.setTimeout(() => {
        goTo(targets);
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      }, 250);
      return () => window.clearTimeout(t);
    };
    const stop = run();
    const again = () => run();
    window.addEventListener("hashchange", again);
    return () => {
      stop?.();
      window.removeEventListener("hashchange", again);
    };
  }, []);
  return null;
}

/* ---------------------------------------------------------------- is it on this page? */

const listeners = new Set<() => void>();
let watcher: MutationObserver | null = null;
function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!watcher) {
    watcher = new MutationObserver(() => listeners.forEach((l) => l()));
    watcher.observe(document.body, { childList: true, subtree: true });
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size) {
      watcher?.disconnect();
      watcher = null;
    }
  };
}
const exists = (targets: string) => targets.split(",").some((t) => document.querySelector(`[data-target="${CSS.escape(t.split(".")[0]!)}"], [data-target="${CSS.escape(t)}"]`));

/** Whether this page has a place for these targets (a link to the right panel shows only when the panel has it). */
export function useTargetsHere(targets: string[] | null): boolean {
  const key = targets?.join(",") ?? "";
  return useSyncExternalStore(subscribe, () => !key || exists(key), () => true);
}
