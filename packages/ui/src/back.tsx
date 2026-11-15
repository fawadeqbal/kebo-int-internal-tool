"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "./cn";

/*
 * Getting around (design "RFQ Desk — getting around"): the back arrow beside a deeper page's title goes one
 * level up, to the page you came from, as you left it. What that needs is remembered here, for this tab only
 * (sessionStorage): each page's last address (a list's search, filters and page), how far down it was, the
 * record opened from it (its row glows on the way back), and where a record was opened from when that was not
 * its own list (Home, Alerts, a customer's page).
 */

const KEY = "kebo.nav";
const EVENT = "kebo:nav";
/** How many addresses keep their scroll (the oldest go first). */
const KEEP = 60;

export interface Place {
  /** The page's address without what only opens a window over it (?panel=…). */
  url: string;
  /** Its name, as the back arrow says it: "Inquiries", "Home", "Kabul Medical Supplies". */
  label: string;
  /** The record the page belongs to ("/orders/abc"), if it is part of one. */
  root?: string;
}

export interface NavMemory {
  /** A page's last address: "/inquiries" → "/inquiries?stage=new&q=pump&page=2". */
  lists: Record<string, string>;
  /** How far down an address was scrolled when it was left. */
  scroll: Record<string, number>;
  /** The page opened from a page, to light its row on the way back: "/inquiries" → "/inquiries/abc". */
  opened: Record<string, string>;
  /** Where a record was opened from: "/orders/abc" → Home. */
  from: Record<string, Place>;
  /** The page on screen, and the one before it. */
  now?: Place;
  before?: Place;
  /** An address to put back as it was (scroll) when it is next shown: set by Back. */
  restore?: string;
}

const empty = (): NavMemory => ({ lists: {}, scroll: {}, opened: {}, from: {} });

let cache: { raw: string | null; value: NavMemory } | null = null;

/** What is remembered (nothing on the server, or where the browser keeps nothing). */
export function readNav(): NavMemory {
  if (typeof window === "undefined") return empty();
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    // Storage switched off: nothing is remembered.
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = empty();
  try {
    if (raw) value = { ...empty(), ...(JSON.parse(raw) as Partial<NavMemory>) };
  } catch {
    // Not ours, or broken: start again.
  }
  cache = { raw, value };
  return value;
}

export function writeNav(change: (m: NavMemory) => void) {
  if (typeof window === "undefined") return;
  const m = structuredClone(readNav());
  change(m);
  const urls = Object.keys(m.scroll);
  for (const u of urls.slice(0, Math.max(0, urls.length - KEEP))) delete m.scroll[u];
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // Full or switched off: Back goes up to the list as it opens.
  }
  window.dispatchEvent(new Event(EVENT));
}

const listen = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};
const useNav = () => useSyncExternalStore(listen, readNav, () => null);

/** Parameters that only open something over a page (a window): not part of where you are. */
const OVER = ["panel", "saved"];

/** A page's address as it is remembered: its path and its own parameters, sorted. */
export function placeOf(path: string, params?: URLSearchParams | string | null): string {
  const p = new URLSearchParams(params ?? "");
  if (p.has("panel")) p.delete("id");
  for (const k of OVER) p.delete(k);
  p.sort();
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

const pathOf = (url: string) => url.split("?")[0]!;

/** Two pages of one record (its tabs): "/orders/abc/payment" and "/orders/abc/shipping". */
const sameRecord = (a: string, b: string) => {
  const x = a.split("/").filter(Boolean);
  const y = b.split("/").filter(Boolean);
  return x.length >= 2 && y.length >= 2 && x[0] === y[0] && x[1] === y[1];
};

/** The record a page belongs to, from the page it goes up to: "/orders" and "/orders/abc/payment" → "/orders/abc". */
export function rootOf(up: string, path: string): string | undefined {
  const upPath = pathOf(up);
  if (!path.startsWith(`${upPath}/`)) return undefined;
  const next = path.slice(upPath.length + 1).split("/")[0];
  return next ? `${upPath}/${next}` : undefined;
}

/** Where Back goes from a page: where its record was opened from, else up to its list as it was left. */
export function backTarget(m: NavMemory | null, up: string, label: string, root?: string): { href: string; label: string } {
  const from = root ? m?.from[root] : undefined;
  if (from && !pathOf(from.url).startsWith(`${root}/`) && pathOf(from.url) !== root) return { href: from.url, label: from.label || label };
  return { href: m?.lists[pathOf(up)] ?? up, label };
}

/** The address one step back in this tab's history, where the browser says (the Navigation API). */
function previousAddress(): string | null {
  const nav = (window as unknown as { navigation?: { entries(): { url: string | null }[]; currentEntry: { index: number } | null } })
    .navigation;
  const i = nav?.currentEntry?.index;
  if (!nav || i === undefined || i < 1) return null;
  const url = nav.entries()[i - 1]?.url;
  if (!url) return null;
  const u = new URL(url);
  return u.origin === window.location.origin ? placeOf(u.pathname, u.search) : null;
}

/**
 * ← beside a deeper page's title, saying where it goes ("Back to Inquiries"): where the record was opened from,
 * or its list with the search, filters and page it had. When that is the page just before in the browser's own
 * history it steps back there (the same as the browser's Back), else it opens it.
 * `bar`: the phone's top bar, where it is the way back.
 */
export function BackArrow({
  up,
  label,
  root,
  bar,
  className,
}: {
  up: string;
  label: string;
  root?: string;
  bar?: boolean;
  className?: string;
}) {
  const m = useNav();
  const router = useRouter();
  const record = root ?? rootOf(up, usePathname());
  const to = backTarget(m, up, label, record);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = placeOf(pathOf(to.href), to.href.split("?")[1]);
    writeNav((n) => {
      n.restore = target;
    });
    if (previousAddress() === target) {
      e.preventDefault();
      router.back();
    }
  };
  return (
    <Link
      href={to.href}
      onClick={onClick}
      aria-label={`Back to ${to.label}`}
      title={`Back to ${to.label}`}
      data-back=""
      data-record-root={record}
      className={cn(
        "no-print grid shrink-0 place-items-center text-text transition-colors focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
        bar
          ? "size-11 rounded-full hover:bg-surface-2 active:bg-surface-2"
          : "mt-0.5 size-10 rounded-[10px] border border-line-strong bg-surface hover:border-primary-solid hover:text-primary",
        className,
      )}
    >
      <ArrowLeft className={bar ? "size-[22px]" : "size-[18px]"} strokeWidth={2.25} aria-hidden />
    </Link>
  );
}

/** A link up to a list (the path above a title): the list as it was left, with its search and filters. */
export function ListLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const m = useNav();
  return (
    <Link href={m?.lists[pathOf(href)] ?? href} className={className}>
      {children}
    </Link>
  );
}

/** The name of the page on screen (what its header declares, else its title) and the record it is part of. */
function labelOnScreen(): { label: string; root?: string } | null {
  const main = document.getElementById("main") ?? document.body;
  const declared = main.querySelector<HTMLElement>("[data-page-label]");
  const text = declared?.dataset.pageLabel || main.querySelector("h1")?.textContent?.trim();
  if (!text) return null;
  const root = main.querySelector<HTMLElement>("[data-back][data-record-root]")?.dataset.recordRoot || undefined;
  return { label: text, root };
}

/** Lights the row of what was opened from this page (a list): it glows for two seconds, in view. */
function lightOpened(path: string, jumped: boolean) {
  const main = document.getElementById("main") ?? document.body;
  const esc = window.CSS?.escape ?? ((s: string) => s.replace(/"/g, '\\"'));
  // A table's row, or a phone list's (ul > li > a; the path above a title is an ol, never lit).
  const rows = [...main.querySelectorAll<HTMLElement>(`tr[data-href="${esc(path)}"], ul > li > a[href="${esc(path)}"]`)];
  const row = rows.map((r) => (r.tagName === "A" ? r.parentElement! : r)).find((r) => r.getClientRects().length > 0);
  if (!row) return;
  const box = row.getBoundingClientRect();
  if (!jumped || box.top < 56 || box.bottom > window.innerHeight) row.scrollIntoView({ block: "center" });
  row.classList.remove("animate-flash");
  void row.offsetWidth;
  row.classList.add("animate-flash");
  window.setTimeout(() => row.classList.remove("animate-flash"), 2200);
}

/**
 * Keeps the memory Back reads (put once in the app's frame): each page's address and scroll as you go, its
 * name once it is on screen, where a record was opened from, and, coming back to a page, its scroll and the
 * row of what you opened from it.
 */
export function NavMemoryKeeper() {
  const pathname = usePathname();
  const params = useSearchParams();
  const url = placeOf(pathname, params);

  // The browser's own Back and Forward put a page back as it was, too.
  useEffect(() => {
    const onPop = () =>
      writeNav((m) => {
        m.restore = placeOf(window.location.pathname, window.location.search);
      });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // How far down the page is, as it scrolls.
  useEffect(() => {
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        writeNav((m) => {
          delete m.scroll[url];
          m.scroll[url] = Math.round(window.scrollY);
        });
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, [url]);

  useEffect(() => {
    const path = pathOf(url);
    let restore: string | undefined;
    let opened: string | undefined;
    let came: string | undefined;
    writeNav((m) => {
      if (m.now && m.now.url !== url) {
        came = m.now.url;
        m.before = m.now;
        m.opened[pathOf(m.now.url)] = path;
      }
      if (!m.now || m.now.url !== url) m.now = { url, label: "" };
      m.lists[path] = url;
      if (m.restore === url) {
        restore = url;
        delete m.restore;
      }
      opened = m.opened[path];
      if (opened) delete m.opened[path];
    });

    // A new page starts at its top. (The browser kept the last page's place: a record opened from far down a
    // list on a phone opened half-way down.) Not coming back, not another tab of the same record, not a page
    // that goes to a part of itself (#…, ?tab=, ?section=).
    const search = new URLSearchParams(url.split("?")[1] ?? "");
    if (came && !restore && pathOf(came) !== path && !sameRecord(pathOf(came), path) && !window.location.hash && !search.has("tab") && !search.has("section"))
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });

    // The page may still be on its way (it streams in): wait for its name, then put it back as it was.
    let tries = 0;
    let frame = 0;
    const settle = () => {
      const here = labelOnScreen();
      if (!here && tries++ < 300) {
        frame = window.requestAnimationFrame(settle);
        return;
      }
      writeNav((m) => {
        if (m.now?.url !== url) return;
        m.now = { url, label: here?.label ?? document.title, root: here?.root };
        // A record opened from outside itself remembers where from (a tab of the same record does not).
        const before = m.before;
        const root = here?.root;
        if (root && before && pathOf(before.url) !== root && !pathOf(before.url).startsWith(`${root}/`)) m.from[root] = before;
      });
      let jumped = false;
      if (restore) {
        const y = readNav().scroll[restore];
        if (y && Math.abs(window.scrollY - y) > 4) {
          window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
          jumped = true;
        }
      }
      // Coming back (Back, or the path above the record's title): the row of what you opened glows.
      const left = readNav().before?.url;
      const back = !!restore || (!!left && !!opened && (pathOf(left) === opened || pathOf(left).startsWith(`${opened}/`)));
      if (opened && opened !== path && back) lightOpened(opened, jumped);
    };
    frame = window.requestAnimationFrame(settle);
    return () => window.cancelAnimationFrame(frame);
  }, [url]);

  return null;
}
