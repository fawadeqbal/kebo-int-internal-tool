"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Clock, Loader2, Search, X } from "lucide-react";
import { SEARCH_KIND_LABEL, type SearchKind, type SearchResult } from "@kebo/shared";
import { Badge, cn, Kbd } from "@kebo/ui";
import { useBackGuard } from "@/components/common/dialog";
import { lockScroll } from "@/lib/scroll-lock";
import { kindCount, kindOne, Marked, SEARCH_ICON as ICON, searchHref } from "./search-bits";

const PAUSE_MS = 220;
const RECENT_KEY = "kebo:recent-searches";

/** The words searched lately, newest first (this browser only). */
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
export function rememberSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6)));
  } catch {
    // Storage may be off (private mode): searching still works, without the list.
  }
}

/** The results for the words being typed: asked once typing pauses, the older answer dropped when newer words come. */
function useResults(text: string) {
  const [state, setState] = useState<{ q: string; result: SearchResult | null; loading: boolean; failed: boolean }>({ q: "", result: null, loading: false, failed: false });
  const q = text.trim();
  useEffect(() => {
    if (q.length < 2) return;
    const ask = new AbortController();
    const timer = window.setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, failed: false }));
      try {
        const res = await fetch(`/search/find?${new URLSearchParams({ q, limit: "3" })}`, { signal: ask.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const result = (await res.json()) as SearchResult;
        setState({ q, result, loading: false, failed: false });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState((s) => ({ ...s, loading: false, failed: true }));
      }
    }, PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      ask.abort();
    };
  }, [q]);
  // What is shown is always for the words in the box: an answer for older words is not.
  const current = q.length >= 2 && state.q === q ? state.result : null;
  return { result: current, loading: q.length >= 2 && (state.loading || state.q !== q) && !state.failed, failed: q.length >= 2 && state.failed };
}

type Option = { id: string; href: string; label: ReactNode; sub?: ReactNode; kind?: SearchKind; badge?: ReactNode; quiet?: boolean; words?: string };

/** The results as one list of options: the record a number names first, then each kind with "See all". */
function optionsOf(result: SearchResult | null, q: string, base: string): { groups: { kind: SearchKind | "exact"; title: string; options: Option[] }[]; flat: Option[] } {
  if (!result) return { groups: [], flat: [] };
  const groups: { kind: SearchKind | "exact"; title: string; options: Option[] }[] = [];
  if (result.exact)
    groups.push({
      kind: "exact",
      title: "Open",
      options: [{ id: `${base}-exact`, href: result.exact.href, kind: result.exact.kind, label: `Open ${result.exact.label}`, sub: kindOne(result.exact.kind), words: result.exact.label }],
    });
  for (const g of result.groups) {
    const options: Option[] = g.items.map((x, i) => ({
      id: `${base}-${g.kind}-${i}`,
      href: x.href,
      kind: g.kind,
      label: <Marked text={x.title} q={q} />,
      sub: <Marked text={x.sub} q={q} />,
      badge: x.badge && (
        <Badge tone={x.badge.tone} className="shrink-0">
          {x.badge.label}
        </Badge>
      ),
      words: x.title,
    }));
    if (g.total > g.items.length) options.push({ id: `${base}-${g.kind}-all`, href: searchHref(q, g.kind), label: `See all ${kindCount(g.kind, g.total)}`, quiet: true });
    groups.push({ kind: g.kind, title: SEARCH_KIND_LABEL[g.kind], options });
  }
  return { groups, flat: groups.flatMap((g) => g.options) };
}

/**
 * The top bar's search (design "search everything", board LSearch): it finds every kind as it is typed —
 * customers, suppliers, inquiries, quotations, orders, purchase orders, payments — grouped, the best first and
 * marked; ↑ ↓ move, Enter opens the one marked (a number typed whole: its record), Esc closes. "See all" and
 * the last line open Search with every result. "/" puts the cursor here (shortcuts.tsx).
 */
export function TopSearch() {
  const router = useRouter();
  const path = usePathname();
  const base = useId().replace(/:/g, "");
  const box = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const { result, loading, failed } = useResults(text);
  const q = text.trim();
  const { groups, flat } = useMemo(() => optionsOf(result, q, base), [result, q, base]);
  const all: Option = { id: `${base}-all`, href: searchHref(q), label: `See all results for “${q}”`, quiet: true };
  const recentOptions: Option[] = q.length < 2 ? recent.map((r, i) => ({ id: `${base}-recent-${i}`, href: searchHref(r), label: r, quiet: true })) : [];
  const list = q.length >= 2 ? (flat.length ? [...flat, all] : []) : recentOptions;
  const shown = open && (q.length >= 2 || recentOptions.length > 0);
  const at = Math.min(active, list.length - 1);

  // A new page: the list closes (worked out while drawing, as React suggests for state that follows a prop).
  const [wasPath, setWasPath] = useState(path);
  if (path !== wasPath) {
    setWasPath(path);
    setOpen(false);
  }

  const go = useCallback(
    (o: Option) => {
      rememberSearch(o.words ?? q);
      setOpen(false);
      setText("");
      box.current?.blur();
      router.push(o.href);
    },
    [q, router],
  );

  return (
    <div role="search" aria-label="Search everything" className="relative hidden max-w-[420px] flex-1 md:block">
      <label htmlFor="global-search" className="sr-only">
        Search everything
      </label>
      {loading ? (
        <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
      ) : (
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      )}
      <input
        ref={box}
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${base}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown && at >= 0 && list[at] ? list[at].id : undefined}
        autoComplete="off"
        placeholder="Search everything: names, numbers, phones…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!list.length) return;
            e.preventDefault();
            setOpen(true);
            setActive((a) => (e.key === "ArrowDown" ? (a + 1) % list.length : (a - 1 + list.length) % list.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (shown && list[at]) go(list[at]);
            else if (result?.exact) go({ id: "exact", href: result.exact.href, label: result.exact.label, words: result.exact.label });
            else if (q.length >= 2) go(all);
          } else if (e.key === "Escape") {
            if (shown) {
              e.preventDefault();
              setOpen(false);
            } else box.current?.blur();
          }
        }}
        className="h-9 w-full rounded-[10px] border border-line-strong bg-[#f8faf9] pr-10 pl-9 text-[13px] text-text transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-primary-solid focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none dark:bg-surface-2 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 lg:inline-flex">
        <Kbd>/</Kbd>
      </span>
      {shown && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-50 w-[min(620px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div id={`${base}-list`} role="listbox" aria-label={q.length >= 2 ? `Results for ${q}` : "Recent searches"} className="max-h-[min(70vh,560px)] overflow-y-auto py-1.5">
            {q.length < 2 ? (
              <div role="group" aria-label="Recent searches">
                <p aria-hidden className="px-4 pt-2 pb-1 text-[11.5px] font-semibold tracking-wide text-text-2 uppercase">
                  Recent searches
                </p>
                {recentOptions.map((o, i) => (
                  <Row key={o.id} o={o} on={i === at} onPick={() => go({ ...o, words: String(o.label) })} onHover={() => setActive(i)} icon={<Clock className="size-4" aria-hidden />} />
                ))}
              </div>
            ) : !result || flat.length === 0 ? (
              // Not a result: said in the list's place, and not picked by Enter.
              <div role="option" aria-selected={false} aria-disabled="true" className="px-4 py-3 text-[13px] text-text-2">
                {!result ? (failed ? "Search did not answer. Try again in a moment." : "Searching…") : `Nothing found for “${q}”. Try a part of a name, a number or a phone.`}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.kind} role="group" aria-label={g.title} className="border-t border-line first:border-t-0">
                  <p aria-hidden className="px-4 pt-2.5 pb-1 text-[11.5px] font-semibold tracking-wide text-text-2 uppercase">
                    {g.title}
                  </p>
                  {g.options.map((o) => {
                    const i = list.indexOf(o);
                    return <Row key={o.id} o={o} on={i === at} onPick={() => go(o)} onHover={() => setActive(i)} />;
                  })}
                </div>
              ))
            )}
            {result && flat.length > 0 && q.length >= 2 && (
              <div role="group" aria-label="Everything" className="border-t border-line">
                <Row o={all} on={list.indexOf(all) === at} onPick={() => go(all)} onHover={() => setActive(list.indexOf(all))} icon={<Search className="size-4" aria-hidden />} />
              </div>
            )}
          </div>
          <p className="flex items-center gap-1.5 border-t border-line bg-surface-2/60 px-4 py-2 text-xs text-text-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move · <Kbd>Enter</Kbd> to open · <Kbd>Esc</Kbd> to close
          </p>
        </div>
      )}
    </div>
  );
}

/** One result: its kind's icon, what it is, a line about it, and where it stands. */
function Row({ o, on, onPick, onHover, icon }: { o: Option; on: boolean; onPick: () => void; onHover: () => void; icon?: ReactNode }) {
  const Icon = o.kind ? ICON[o.kind] : null;
  return (
    <div
      id={o.id}
      role="option"
      aria-selected={on}
      // Keeps the focus in the box (a click would blur it first and close the list).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn("flex min-h-11 cursor-pointer items-center gap-3 border-l-[3px] px-[13px] py-1.5", on ? "border-primary bg-primary-soft/60" : "border-transparent")}
    >
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-2">
        {icon ?? (Icon ? <Icon className="size-4" /> : <Search className="size-4" />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13.5px]", o.quiet ? "font-medium text-primary" : "font-semibold text-text")}>{o.label}</span>
        {o.sub && <span className="block truncate text-xs text-text-2">{o.sub}</span>}
      </span>
      {o.badge}
    </div>
  );
}

/**
 * On a phone (board PSearch): the search icon opens search on the whole screen — the box ready to type, recent
 * searches under it, the results grouped as big rows; ← closes it, and so does the phone's Back.
 */
export function PhoneSearch() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="grid size-10 place-items-center rounded-md text-text hover:bg-surface-2 md:hidden" aria-label="Search everything" onClick={() => setOpen(true)}>
        <Search className="size-5" aria-hidden />
      </button>
      {/* Over everything (the top bar keeps its own layer): drawn at the page's end. */}
      {open && createPortal(<PhoneSearchScreen onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function PhoneSearchScreen({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [recent] = useState(readRecent);
  const { result, loading, failed } = useResults(text);
  const q = text.trim();
  useEffect(() => lockScroll(), []);
  useBackGuard(onClose, () => true);
  const go = (href: string, words?: string) => {
    rememberSearch(words ?? q);
    onClose();
    router.push(href);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Search everything" className="fixed inset-0 z-[70] flex flex-col bg-surface md:hidden">
      <form
        role="search"
        className="flex items-center gap-2 border-b border-line px-2 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (result?.exact) go(result.exact.href, result.exact.label);
          else if (q.length >= 2) go(searchHref(q));
        }}
      >
        <button type="button" onClick={onClose} aria-label="Close search" className="grid size-11 shrink-0 place-items-center rounded-md text-text">
          <ArrowLeft className="size-[22px]" aria-hidden />
        </button>
        <label htmlFor="phone-search" className="sr-only">
          Search everything
        </label>
        <span className="relative flex-1">
          {loading ? (
            <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
          ) : (
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          )}
          <input
            id="phone-search"
            type="search"
            enterKeyHint="search"
            autoFocus
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Names, numbers, phones…"
            className="h-11 w-full rounded-xl border-2 border-primary-solid bg-surface pr-10 pl-9 text-base text-text focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={() => setText("")} aria-label="Clear the words" className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center text-muted">
              <X className="size-4" aria-hidden />
            </button>
          )}
        </span>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {q.length < 2 ? (
          recent.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-3" aria-label="Recent searches" role="group">
              {recent.map((r) => (
                <button key={r} type="button" onClick={() => setText(r)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] text-text">
                  <Clock className="size-3.5 text-muted" aria-hidden />
                  {r}
                </button>
              ))}
            </div>
          )
        ) : !result ? (
          <p className="px-4 py-4 text-sm text-text-2">{failed ? "Search did not answer. Try again in a moment." : "Searching…"}</p>
        ) : result.groups.length === 0 && !result.exact ? (
          <p className="px-4 py-4 text-sm text-text-2">Nothing found for “{q}”. Try a part of a name, a number or a phone.</p>
        ) : (
          <>
            {result.exact && (
              <PhoneGroup title="Open">
                <PhoneRow href={result.exact.href} kind={result.exact.kind} title={`Open ${result.exact.label}`} sub={kindOne(result.exact.kind)} q={q} onGo={() => go(result.exact!.href, result.exact!.label)} />
              </PhoneGroup>
            )}
            {result.groups.map((g) => (
              <PhoneGroup key={g.kind} title={SEARCH_KIND_LABEL[g.kind]} all={g.total > g.items.length ? { href: searchHref(q, g.kind), label: `See all ${g.total}`, onGo: () => go(searchHref(q, g.kind)) } : undefined}>
                {g.items.map((x) => (
                  <PhoneRow key={x.href} href={x.href} kind={g.kind} title={x.title} sub={x.sub} badge={x.badge} q={q} onGo={() => go(x.href, x.title)} />
                ))}
              </PhoneGroup>
            ))}
            <div className="px-4 py-3">
              <Link
                href={searchHref(q)}
                onClick={(e) => {
                  e.preventDefault();
                  go(searchHref(q));
                }}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
              >
                See all results for “{q}”
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhoneGroup({ title, all, children }: { title: string; all?: { href: string; label: string; onGo: () => void }; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line">
      <div className="flex items-center justify-between bg-surface-2/60 px-4 py-1.5">
        <h2 className="text-[11.5px] font-semibold tracking-wide text-text-2 uppercase">{title}</h2>
        {all && (
          <Link
            href={all.href}
            onClick={(e) => {
              e.preventDefault();
              all.onGo();
            }}
            className="inline-flex min-h-8 items-center text-[13px] font-medium text-primary"
          >
            {all.label}
          </Link>
        )}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function PhoneRow({ href, kind, title, sub, badge, q, onGo }: { href: string; kind: SearchKind; title: string; sub: string; badge?: SearchResult["groups"][number]["items"][number]["badge"]; q: string; onGo: () => void }) {
  const Icon = ICON[kind];
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        href={href}
        onClick={(e) => {
          e.preventDefault();
          onGo();
        }}
        className="flex min-h-14 items-center gap-3 px-4 py-2"
      >
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-2">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-text">
            <Marked text={title} q={q} />
          </span>
          <span className="block truncate text-[13px] text-text-2">
            <Marked text={sub} q={q} />
          </span>
        </span>
        {badge && (
          <Badge tone={badge.tone} className="shrink-0">
            {badge.label}
          </Badge>
        )}
      </Link>
    </li>
  );
}
