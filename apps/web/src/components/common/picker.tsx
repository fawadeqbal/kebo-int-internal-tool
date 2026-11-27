"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Button, cn, controlClass, controlSizes, capsClass } from "@kebo/ui";

/** What a picker shows for one choice: its name, a grey line under it, and a short word at the end (a country). */
export type PickerOption = { id: string; name: string };
export type PickerLine = { sub?: ReactNode; end?: ReactNode; endTone?: "warn" };
/** A group shown first and found by typing (a supplier: the ones asked for this inquiry). */
export type PickerGroup<T> = { title: string; rows: T[]; line?: (row: T) => PickerLine };

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/**
 * The one picker (canvas board "The one field": Select up to 7 choices; more, or names, this picker). Customer,
 * supplier and every other name to choose: a search box, the first group (Recent, or Asked for this inquiry), the
 * results, and "+ New …" as the last choice. ↑ ↓ move, Enter takes, Esc closes; chosen, it is a card with Change.
 */
export function Picker<T extends PickerOption>({
  inputId,
  placeholder,
  listLabel,
  icon,
  chosen,
  onClear,
  onPick,
  search,
  recent,
  recentTitle = "Recent",
  first,
  othersTitle = "All",
  line,
  newLabel,
  onNew,
  newOnlyWhenTyped = false,
  empty,
  error,
  disabled,
  disabledReason,
}: {
  inputId: string;
  placeholder: string;
  listLabel: string;
  /** The card's icon (a building, a supplier). */
  icon: ReactNode;
  /** What is chosen: the card's two lines; null shows the search. */
  chosen: { name: string; sub?: ReactNode } | null;
  /** Change on the card: back to the search. */
  onClear: () => void;
  onPick: (row: T) => void;
  search: (q: string) => Promise<T[]>;
  /** Shown before anything is typed. */
  recent?: () => Promise<T[]>;
  recentTitle?: string;
  /** A group shown first (filtered by what is typed); its rows are left out of the results. */
  first?: PickerGroup<T>;
  /** The results' title before anything is typed, when there is a first group. */
  othersTitle?: string;
  /** The grey line and end word of a result. */
  line: (row: T) => PickerLine;
  /** "+ New customer": the last choice, called with what was typed. */
  newLabel?: string;
  onNew?: (typed: string) => void;
  /** Offer "+ New …" only once something is typed, and not when a name matches it exactly. */
  newOnlyWhenTyped?: boolean;
  /** The line when nothing is found. */
  empty: (typed: string) => string;
  error?: string[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const call = useRef(0);
  const typed = q.trim();
  const low = typed.toLowerCase();
  const showRecent = !typed && !!recent;

  useEffect(() => {
    if (!open) return;
    const n = ++call.current;
    const t = setTimeout(
      async () => {
        setLoading(true);
        const found = showRecent ? await recent!() : await search(q);
        if (n !== call.current) return;
        setRows(found);
        setActive(0);
        setLoading(false);
      },
      showRecent ? 0 : 200,
    );
    return () => clearTimeout(t);
  }, [q, open, search, recent, showRecent]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (chosen)
    return (
      // A phone puts why it is locked under the name, so the name is never cut short.
      <div className={cn("flex min-h-12 items-center gap-3 rounded-[10px] border border-line bg-surface-2/60 px-3 py-2", disabled && disabledReason && "max-sm:flex-wrap", error && "border-bad")}>
        <span className="shrink-0 text-muted [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{chosen.name}</p>
          {chosen.sub && <p className="truncate text-xs text-text-2">{chosen.sub}</p>}
        </div>
        {disabled ? (
          disabledReason && <span className="max-w-56 text-right text-xs text-muted max-sm:w-full max-sm:max-w-none max-sm:pl-7 max-sm:text-left">{disabledReason}</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onClear();
              setOpen(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            Change
          </Button>
        )}
      </div>
    );

  const firstRows = first ? first.rows.filter((r) => !low || r.name.toLowerCase().includes(low)) : [];
  const results = first ? rows.filter((r) => !first.rows.some((f) => f.id === r.id)) : rows;
  const all = [...firstRows, ...results];
  const exact = [...(first?.rows ?? []), ...rows].some((r) => r.name.toLowerCase() === low);
  const offerNew = !!onNew && (!newOnlyWhenTyped || (!!typed && !exact));
  const count = all.length + (offerNew ? 1 : 0);
  const listId = `${id}-list`;
  const optionId = (i: number) => (i < all.length ? `${id}-${all[i]!.id}` : `${id}-new`);
  const take = (i: number) => {
    if (i < all.length) {
      onPick(all[i]!);
      setOpen(false);
      setQ("");
    } else if (offerNew) {
      setOpen(false);
      onNew!(typed);
    }
  };
  const group = (title: string) => (
    <li role="presentation" className={cn(capsClass, "px-2.5 pt-1.5 pb-1")}>
      {title}
    </li>
  );
  const option = (r: T, i: number, l: PickerLine) => (
    <li
      key={r.id}
      id={optionId(i)}
      role="option"
      aria-selected={i === active}
      onMouseEnter={() => setActive(i)}
      onMouseDown={(e) => {
        e.preventDefault();
        take(i);
      }}
      className={cn("grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-2", i === active && "bg-surface-2")}
    >
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-surface-3 text-xs font-bold text-text-2">
        {initials(r.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{r.name}</span>
        {l.sub && <span className="block truncate text-xs text-text-2">{l.sub}</span>}
      </span>
      {l.end ? <span className={cn("shrink-0 text-xs text-text-2", l.endTone === "warn" && "rounded bg-warn-soft px-1.5 text-warn")}>{l.end}</span> : <span />}
    </li>
  );

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={input}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={!!error || undefined}
        aria-activedescendant={open && active < count ? optionId(active) : undefined}
        autoComplete="off"
        value={q}
        placeholder={placeholder}
        className={cn(controlClass, controlSizes.md, "pr-9 pl-9")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, count - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && active < count) take(active);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <ul id={listId} role="listbox" aria-label={listLabel} className="max-h-80 scroll-y scroll-sm p-1">
            {firstRows.length > 0 && first && group(first.title)}
            {firstRows.map((r, i) => option(r, i, (first?.line ?? line)(r)))}
            {/* "Other suppliers" only after a first group: alone it named nothing (e2e 24 Nov). */}
            {results.length > 0 && (showRecent || typed || firstRows.length > 0) && group(showRecent ? recentTitle : typed ? `Results for “${typed}”` : othersTitle)}
            {results.map((r, k) => option(r, firstRows.length + k, line(r)))}
            {!loading && all.length === 0 && (
              <li role="presentation" className="px-2.5 py-3 text-sm text-text-2">
                {empty(typed)}
              </li>
            )}
            {offerNew && (
              <li
                id={optionId(all.length)}
                role="option"
                aria-selected={active === all.length}
                onMouseEnter={() => setActive(all.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(all.length);
                }}
                className={cn(
                  "mt-1 grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg border-t border-line px-2.5 py-2 font-semibold text-primary",
                  active === all.length && "bg-surface-2",
                )}
              >
                <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-primary-soft">
                  <Plus className="size-4" />
                </span>
                <span className="truncate text-sm">{typed ? `${newLabel} “${typed}”` : newLabel}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
