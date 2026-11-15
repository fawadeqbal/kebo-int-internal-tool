"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, Search, X } from "lucide-react";
import { cn } from "@kebo/ui";
import { FloatingMenu, useIsPhone } from "./floating";

export interface FilterSelect {
  /** The URL parameter. */
  name: string;
  /** The button's name: "Category". */
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  /** The first choice in its menu, which takes the filter off ("All" by default; "Anyone", "Any day"…). */
  all?: string;
  /** Not choosing still narrows the list (Has balance: Yes): the button says so. */
  showDefault?: boolean;
}

/** A list by month: ‹ November 2026 › in the same line, and the months (and years) to choose from. */
export interface FilterMonth {
  /** The URL parameter. */
  name: string;
  /** What the list shows now: a month ("2026-11"), a year ("2026"), or "" (every date). */
  current: string;
  /** The value that needs no parameter (this month, or "" where every date is the default). */
  base: string;
  /** This month: › goes no further. */
  thisMonth: string;
  /** What the button says ("November 2026", "Every date"). */
  label: string;
  options: { value: string; label: string }[];
}

/** A month and the one before or after it ("2026-11" → "2026-10"). */
const step = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const isMonth = (v: string) => /^\d{4}-\d{2}$/.test(v);

/** A choice in a filter's menu: a tick on the one chosen now. */
function Choice({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2",
        on ? "font-semibold text-primary" : "text-text",
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center">{on && <Check className="size-4" aria-hidden />}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/** A long list of choices (people, customers, suppliers) starts with a box to type in. */
const LONG = 8;

/** One filter: its name, or (chosen) green with the choice and × to take it off. Its choices open under it (a sheet on a phone). */
function FilterButton({ s, onPick }: { s: FilterSelect; onPick: (name: string, value: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const phone = useIsPhone();
  const chosen = s.value ? s.options.find((o) => o.value === s.value) : undefined;
  const long = s.options.length > LONG;
  const shown = find.trim() ? s.options.filter((o) => o.label.toLowerCase().includes(find.trim().toLowerCase())) : s.options;
  const close = () => {
    setOpen(false);
    setFind("");
  };
  const pick = (value: string | undefined) => {
    close();
    if (value !== (s.value || undefined)) onPick(s.name, value);
  };
  return (
    <span
      className={cn(
        "inline-flex h-10 shrink-0 items-stretch overflow-hidden rounded-[10px] border text-[13px] font-semibold max-sm:h-11",
        chosen ? "border-primary-line bg-primary-soft text-primary max-sm:-order-1" : "border-line-strong bg-surface text-text-2 hover:border-text-2/40",
      )}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex items-center gap-1.5 pr-2.5 pl-3 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {chosen ? (
          <>
            {s.label}: <span className="font-bold">{chosen.label}</span>
          </>
        ) : s.showDefault && s.all ? (
          <>
            {s.label}: {s.all}
          </>
        ) : (
          s.label
        )}
        {!chosen && <ChevronDown className="size-4 opacity-70" aria-hidden />}
      </button>
      {chosen && (
        <button
          type="button"
          aria-label={`Take off ${s.label}`}
          onClick={() => onPick(s.name, undefined)}
          className="grid w-8 place-items-center border-l border-primary-line outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {open && (
        <FloatingMenu anchor={() => button.current} onClose={close} label={s.label} align="start" width={long ? 300 : 240} focus={long && !phone ? "input" : undefined}>
          {long && (
            <label className="mx-0.5 mt-0.5 mb-1 flex h-9 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 max-sm:h-11">
              <Search className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="sr-only">Find {s.label.toLowerCase()}</span>
              <input
                type="search"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown.length) {
                    e.preventDefault();
                    pick(shown[0]!.value);
                  }
                }}
                placeholder="Type to find…"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
              />
            </label>
          )}
          {!find.trim() && (
            <>
              <Choice label={s.all ?? "All"} on={!chosen} onPick={() => pick(undefined)} />
              <span role="separator" className="mx-1 my-1 block h-px shrink-0 bg-line" />
            </>
          )}
          {shown.map((o) => (
            <Choice key={o.value} label={o.label} on={o.value === s.value} onPick={() => pick(o.value)} />
          ))}
          {find.trim() && !shown.length && <p className="px-2.5 py-2 text-sm text-muted">Nothing matches “{find.trim()}”.</p>}
        </FloatingMenu>
      )}
    </span>
  );
}

/** ‹ November 2026 › : a month back or on, and the month opens the list of months (and years). */
function MonthStep({ m, onPick }: { m: FilterMonth; onPick: (name: string, value: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const go = (value: string) => onPick(m.name, value === m.base ? undefined : value || undefined);
  const month = isMonth(m.current) ? m.current : null;
  const prev = month ? step(month, -1) : null;
  const next = month && month < m.thisMonth ? step(month, 1) : null;
  const arrow = "grid w-9 place-items-center text-text-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-35";
  return (
    <span className="inline-flex h-10 shrink-0 items-stretch overflow-hidden rounded-[10px] border border-line-strong bg-surface text-[13px] font-semibold max-sm:h-11">
      <button type="button" aria-label="The month before" disabled={!prev} onClick={() => prev && go(prev)} className={arrow}>
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 border-x border-line px-3 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          open ? "bg-primary-soft text-primary" : "text-text",
        )}
      >
        {m.label}
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </button>
      <button type="button" aria-label="The month after" disabled={!next} onClick={() => next && go(next)} className={arrow}>
        <ChevronRight className="size-4" aria-hidden />
      </button>
      {open && (
        <FloatingMenu anchor={() => button.current} onClose={() => setOpen(false)} label="Month" align="start" width={230}>
          {m.options.map((o) => (
            <Choice
              key={o.value || "all"}
              label={o.label}
              on={o.value === m.current}
              onPick={() => {
                setOpen(false);
                if (o.value !== m.current) go(o.value);
              }}
            />
          ))}
        </FloatingMenu>
      )}
    </span>
  );
}

/**
 * The filters of a list, in one line under its tabs: the search (it finds as you type), then a button per filter
 * named only by what it filters; a choice changes the list at once. A chosen filter is green and says the choice,
 * with × to take it off, and "Clear all" takes off every one. Lists by month have ‹ month › in the same line.
 * On a phone: the search on its own line, the buttons in one line that slides sideways, chosen ones first.
 * Every choice is in the URL (Back and a shared link show the same list); `keep` carries the tabs' parameters,
 * and anything else (the page number) starts again, as a new search should.
 */
export function FilterCard({
  search,
  value,
  selects = [],
  keep = {},
  month,
  count,
}: {
  /** The search box's words: "Search number, title, customer…". */
  search: string;
  value?: string;
  selects?: FilterSelect[];
  keep?: Record<string, string | undefined>;
  month?: FilterMonth;
  /** How many are shown: "109 inquiries". */
  count?: string;
  /** No longer used: the search's × clears it in place. */
  clearHref?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [text, setText] = useState(value ?? "");
  // The box follows the page when the search changes elsewhere (Back, Clear all, a tab).
  const [was, setWas] = useState(value ?? "");
  if ((value ?? "") !== was) {
    setWas(value ?? "");
    setText(value ?? "");
  }

  const go = (changes: Record<string, string | undefined>) => {
    const all: Record<string, string | undefined> = { ...keep, q: value || undefined };
    for (const s of selects) all[s.name] = s.value || undefined;
    if (month) all[month.name] = month.current === month.base ? undefined : month.current || undefined;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...all, ...changes })) if (v) p.set(k, v);
    const qs = p.toString();
    const url = qs ? `${path}?${qs}` : path;
    // Typing more into a search already made replaces it; anything else is a step Back can undo.
    const typing = "q" in changes && Object.keys(changes).length === 1 && !!value && !!changes.q;
    start(() => (typing ? router.replace(url, { scroll: false }) : router.push(url, { scroll: false })));
  };

  // The search finds as you type: a short pause after the last key.
  const latest = useRef(go);
  useEffect(() => {
    latest.current = go;
  });
  useEffect(() => {
    const t = text.trim();
    if (t === (value ?? "").trim()) return;
    const id = setTimeout(() => latest.current({ q: t || undefined }), 450);
    return () => clearTimeout(id);
  }, [text, value]);

  const pick = (name: string, v: string | undefined) => go({ [name]: v });
  const anyOn = !!value || selects.some((s) => s.value);
  const clear = () => {
    setText("");
    go({ q: undefined, ...Object.fromEntries(selects.map((s) => [s.name, undefined])) });
  };

  return (
    <div role="search" aria-label="Filter the list" aria-busy={pending} className="mb-4 flex flex-wrap items-center gap-2">
      <label className="relative flex h-10 min-w-0 flex-[0_1_340px] items-center rounded-[10px] border border-line-strong bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 max-sm:h-11 max-sm:basis-full">
        <span className="sr-only">{search.replace(/…$/, "")}</span>
        {pending ? (
          <LoaderCircle className="pointer-events-none absolute left-3 size-4 animate-spin text-muted" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
        )}
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (text.trim() !== (value ?? "").trim()) go({ q: text.trim() || undefined });
          }}
          placeholder={search}
          className="h-full w-full min-w-0 bg-transparent pr-9 pl-9 text-[13.5px] text-text outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text && (
          <button
            type="button"
            aria-label="Empty the search"
            onClick={() => {
              setText("");
              if (value) go({ q: undefined });
            }}
            className="absolute right-1.5 grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </label>
      {(selects.length > 0 || month || anyOn) && (
        <div className="flex min-w-0 items-center gap-2 max-sm:-mx-4 max-sm:basis-[calc(100%+2rem)] max-sm:overflow-x-auto max-sm:px-4 max-sm:py-0.5 max-sm:[scrollbar-width:none] sm:flex-wrap max-sm:[&::-webkit-scrollbar]:hidden">
          {selects.map((s) => (
            <FilterButton key={s.name} s={s} onPick={pick} />
          ))}
          {month && <MonthStep m={month} onPick={pick} />}
          {anyOn && (
            <button type="button" onClick={clear} className="h-10 shrink-0 rounded-md px-1.5 text-[13px] font-semibold whitespace-nowrap text-primary hover:underline max-sm:h-11">
              Clear all
            </button>
          )}
        </div>
      )}
      {count && (
        <span className="ml-auto text-[13px] whitespace-nowrap text-muted max-sm:hidden" aria-live="polite">
          {count}
        </span>
      )}
    </div>
  );
}
