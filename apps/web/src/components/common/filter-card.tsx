"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ListFilter, LoaderCircle, Search, X } from "lucide-react";
import { cn, RULES, searchFrameClass, controlSizes, EmptyLine, Button } from "@kebo/ui";
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

/** How long the search waits after the last key before it looks: longer than the gap between a slow typist's
 * letters (a phone's keyboard too), short enough to feel at once when the typing stops. Enter looks at once. */
export const SEARCH_PAUSE_MS = 600;

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
const LONG = RULES.choices.list;

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
        "inline-flex h-10 shrink-0 items-stretch overflow-hidden rounded-[10px] border text-md font-semibold",
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
          {find.trim() && !shown.length && <EmptyLine className="px-2.5 py-2">Nothing matches “{find.trim()}”.</EmptyLine>}
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
    <span className="inline-flex h-10 shrink-0 items-stretch overflow-hidden rounded-[10px] border border-line-strong bg-surface text-md font-semibold">
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
 * A phone's filters (design "list pages" 18 Nov): one sheet with every filter, its choices as buttons (a long list
 * as rows, with a box to find in), each applied at once; Clear, and one strong button that closes it and says
 * what the list now holds ("Show 15 inquiries").
 */
function FilterSheet({
  selects,
  onPick,
  onClear,
  count,
  anyOn,
  onClose,
}: {
  selects: FilterSelect[];
  onPick: (name: string, value: string | undefined) => void;
  onClear: () => void;
  count?: string;
  anyOn: boolean;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [find, setFind] = useState<Record<string, string>>({});
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-x-0 top-[var(--vvt,0px)] z-[110] flex h-[var(--vvh,100dvh)] flex-col justify-end">
      <button type="button" aria-label="Close the filters" tabIndex={-1} className="absolute inset-0 bg-black/40 animate-in fade-in" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label="Filters" className="relative flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-pop">
        <span className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-center justify-between border-b border-line py-1 pr-1.5 pl-4">
          <p className="text-lg font-bold text-text">Filters</p>
          <button type="button" data-sheet-close aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-full text-text-2 hover:bg-surface-2">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
          {selects.map((f) => {
            const all = { value: "", label: f.all ?? "All" };
            // Choices as buttons; a long list (people, customers) as rows with a box to find in.
            const rows = f.options.length > LONG;
            const q = (find[f.name] ?? "").trim().toLowerCase();
            const shown = q ? f.options.filter((o) => o.label.toLowerCase().includes(q)) : f.options;
            const on = (v: string) => (f.value ?? "") === v;
            return (
              <section key={f.name} aria-label={f.label}>
                <h3 className="mt-4 mb-2 text-md font-bold text-text-2">{f.label}</h3>
                {rows ? (
                  <div role="radiogroup" aria-label={f.label}>
                    <label className="mb-1 flex h-11 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-lead focus-within:border-primary">
                      <Search className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="sr-only">Find {f.label.toLowerCase()}</span>
                      <input
                        type="search"
                        value={find[f.name] ?? ""}
                        onChange={(e) => setFind((x) => ({ ...x, [f.name]: e.target.value }))}
                        className="min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:appearance-none"
                      />
                    </label>
                    {[...(q ? [] : [all]), ...shown].map((o) => (
                      <button
                        key={o.value || "all"}
                        type="button"
                        role="radio"
                        aria-checked={on(o.value)}
                        onClick={() => onPick(f.name, o.value || undefined)}
                        className="flex min-h-11 w-full items-center gap-3 border-b border-line/70 text-left text-lead text-text last:border-b-0"
                      >
                        <span className={cn("size-5 shrink-0 rounded-full border-[1.5px] border-line-strong", on(o.value) && "border-[6px] border-primary-solid")} aria-hidden />
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {[all, ...f.options].map((o) => (
                      <button
                        key={o.value || "all"}
                        type="button"
                        aria-pressed={on(o.value)}
                        onClick={() => onPick(f.name, o.value || undefined)}
                        className={cn(
                          "h-10 rounded-full border px-3.5 text-sm font-semibold",
                          on(o.value) ? "border-primary-line bg-primary-soft text-primary" : "border-line-strong bg-surface text-text-2",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="flex gap-2 border-t border-line bg-surface px-4 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <Button size="lg" onClick={onClear} disabled={!anyOn}>
            Clear
          </Button>
          <Button size="lg" variant="strong" onClick={onClose} className="flex-1">
            {count ? `Show ${count}` : "Show the list"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
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
  end,
}: {
  /** At the end of the line on a laptop, after the count (Select). */
  end?: ReactNode;
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
  const shown = (value ?? "").trim();
  const [text, setText] = useState(value ?? "");
  // The searches this box sent that the page has not shown yet, oldest first.
  const [asked, setAsked] = useState<string[]>([]);
  // The box follows the page when its search changes elsewhere (Back, a tab, a link). When the page comes back
  // with a search this box sent, the box keeps what was typed since: typing on while it looks never loses a letter.
  const [was, setWas] = useState(shown);
  if (shown !== was) {
    setWas(shown);
    const i = asked.lastIndexOf(shown);
    if (i >= 0) setAsked(asked.slice(i + 1));
    else {
      setAsked([]);
      setText(value ?? "");
    }
  }

  const go = (changes: Record<string, string | undefined>) => {
    // The list is searched for what the box says, even words not looked for yet (a filter chosen while typing).
    const q = ("q" in changes ? changes.q : text.trim()) || undefined;
    const all: Record<string, string | undefined> = { ...keep };
    for (const s of selects) all[s.name] = s.value || undefined;
    if (month) all[month.name] = month.current === month.base ? undefined : month.current || undefined;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...all, ...changes, q })) if (v) p.set(k, v);
    const qs = p.toString();
    const url = qs ? `${path}?${qs}` : path;
    // A new search: the page will come back with it (a filter chosen, the same search: nothing to wait for).
    if ((q ?? "") !== shown) setAsked((a) => [...a, q ?? ""]);
    // Typing more into a search already made replaces it; anything else is a step Back can undo.
    const typing = "q" in changes && Object.keys(changes).length === 1 && !!shown && !!q;
    start(() => (typing ? router.replace(url, { scroll: false }) : router.push(url, { scroll: false })));
  };

  // The search finds as you type, once the typing pauses: not between the letters of a word.
  const latest = useRef(go);
  useEffect(() => {
    latest.current = go;
  });
  const coming = asked.at(-1);
  useEffect(() => {
    const t = text.trim();
    // Nothing new to look for: the list shows it, or it is on its way.
    if (t === shown || t === coming) return;
    const id = setTimeout(() => latest.current({ q: t || undefined }), SEARCH_PAUSE_MS);
    return () => clearTimeout(id);
  }, [text, shown, coming]);

  const pick = (name: string, v: string | undefined) => go({ [name]: v });
  const anyOn = !!value || selects.some((s) => s.value);
  const chosen = selects.filter((s) => s.value).length;
  const [sheet, setSheet] = useState(false);
  const clear = () => {
    setText("");
    go({ q: undefined, ...Object.fromEntries(selects.map((s) => [s.name, undefined])) });
  };

  return (
    <div role="search" aria-label="Filter the list" aria-busy={pending} className="mb-4 flex flex-wrap items-center gap-2">
      <label className={cn(searchFrameClass, controlSizes.md, "relative flex min-w-0 flex-[0_1_340px] items-center", selects.length ? "max-sm:flex-1" : "max-sm:basis-full")}>
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
            // Enter looks at once (and again, if a search on its way was lost).
            if (text.trim() !== shown) go({ q: text.trim() || undefined });
          }}
          placeholder={search}
          className="h-full w-full min-w-0 bg-transparent pr-9 pl-9 text-sm text-text outline-none placeholder:text-muted max-sm:text-base [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text && (
          <button
            type="button"
            aria-label="Empty the search"
            onClick={() => {
              setText("");
              if (shown || asked.length) go({ q: undefined });
            }}
            className="absolute right-1.5 grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </label>
      {/* A phone: one Filters button beside the search (the number of filters on), the choices in a sheet. */}
      {selects.length > 0 && (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-sm font-semibold sm:hidden",
            chosen ? "border-primary-line bg-primary-soft text-primary" : "border-line-strong bg-surface text-text",
          )}
        >
          <ListFilter className="size-4" aria-hidden /> Filters
          {chosen > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary-solid px-1 text-2xs font-bold text-white">{chosen}</span>}
        </button>
      )}
      {(selects.length > 0 || month || anyOn) && (
        <div className={cn("flex min-w-0 items-center gap-2 max-sm:basis-full sm:flex-wrap", !month && "max-sm:hidden")}>
          {selects.map((s) => (
            <span key={s.name} className="contents max-sm:hidden">
              <FilterButton s={s} onPick={pick} />
            </span>
          ))}
          {month && <MonthStep m={month} onPick={pick} />}
          {anyOn && (
            <button type="button" onClick={clear} className="h-10 shrink-0 rounded-md px-1.5 text-md font-semibold whitespace-nowrap text-primary hover:underline max-sm:hidden">
              Clear all
            </button>
          )}
        </div>
      )}
      {count && (
        <span className="ml-auto text-md whitespace-nowrap text-muted max-sm:hidden" aria-live="polite">
          {count}
        </span>
      )}
      {end && <div className="flex items-center gap-2 max-sm:hidden">{end}</div>}
      {sheet && <FilterSheet selects={selects} onPick={pick} onClear={clear} count={count} anyOn={anyOn} onClose={() => setSheet(false)} />}
    </div>
  );
}
