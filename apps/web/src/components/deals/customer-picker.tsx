"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Loader2, Plus, Search } from "lucide-react";
import { Button, cn, controlClass } from "@kebo/ui";
import { countryName } from "@/lib/countries";
import type { CustomerOption } from "@/lib/types-deals";

const countryText = (c: string) => (c === "ZZ" ? "Country not set" : countryName(c));
const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/**
 * The customer picker (design rules 18 Nov): one search box. Before anything is typed it lists the recent
 * customers; while typing, the results — each with its main contact and country. "+ New customer" is the last
 * choice, with what was typed carried over. Keyboard: ↑ ↓ Enter, Escape.
 */
export function CustomerPicker({
  value,
  onChange,
  search,
  recent,
  onNew,
  newLabel = "New customer",
  error,
  disabled,
  disabledReason,
}: {
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
  search: (q: string) => Promise<CustomerOption[]>;
  /** The recent customers, shown before anything is typed. */
  recent?: () => Promise<CustomerOption[]>;
  /** "+ New customer": called with what was typed. */
  onNew?: (typed: string) => void;
  newLabel?: string;
  error?: string[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const call = useRef(0);
  const typed = q.trim();
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

  const pick = (c: CustomerOption) => {
    onChange(c);
    setOpen(false);
    setQ("");
  };
  // "+ New customer" is the last choice of the list (↓ reaches it, Enter takes it).
  const count = rows.length + (onNew ? 1 : 0);
  const choose = (i: number) => {
    if (i < rows.length) pick(rows[i]!);
    else if (onNew) {
      setOpen(false);
      onNew(typed);
    }
  };

  if (value)
    return (
      // A phone puts why it is locked under the name, so the name is never cut short.
      <div className={cn("flex min-h-12 items-center gap-3 rounded-[10px] border border-line bg-surface-2/60 px-3 py-2", disabled && disabledReason && "max-sm:flex-wrap", error && "border-bad")}>
        <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{value.name}</p>
          <p className="truncate text-xs text-text-2">
            {countryText(value.country)}
            {value.primaryContact ? ` · ${value.primaryContact.name} (main contact)` : ""}
          </p>
        </div>
        {disabled ? (
          disabledReason && <span className="max-w-56 text-right text-xs text-muted max-sm:w-full max-sm:max-w-none max-sm:pl-7 max-sm:text-left">{disabledReason}</span>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              onChange(null);
              setOpen(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            Change
          </Button>
        )}
      </div>
    );

  const listId = `${id}-list`;
  const optionId = (i: number) => (i < rows.length ? `${id}-${rows[i]!.id}` : `${id}-new`);
  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={input}
        id="customer"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={!!error || undefined}
        aria-activedescendant={open && active < count ? optionId(active) : undefined}
        autoComplete="off"
        value={q}
        placeholder="Search customers"
        className={cn(controlClass, "h-10 pr-9 pl-9 max-sm:h-11 max-sm:text-base")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
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
            if (open && active < count) choose(active);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <ul id={listId} role="listbox" aria-label="Customers" className="max-h-80 overflow-y-auto p-1">
            {rows.length > 0 && (
              <li role="presentation" className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold tracking-wide text-text-2 uppercase">
                {showRecent ? "Recent" : `Results for “${typed || "all"}”`}
              </li>
            )}
            {rows.map((c, i) => (
              <li
                key={c.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className={cn("grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-2", i === active && "bg-surface-2")}
              >
                <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-surface-3 text-xs font-bold text-text-2">
                  {initials(c.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{c.name}</span>
                  <span className="block truncate text-xs text-text-2">
                    {c.primaryContact ? [c.primaryContact.name, c.primaryContact.detail].filter(Boolean).join(" · ") : "No contact"}
                  </span>
                </span>
                <span className={cn("shrink-0 text-xs text-text-2", c.country === "ZZ" && "rounded bg-warn-soft px-1.5 text-warn")}>{countryText(c.country)}</span>
              </li>
            ))}
            {!loading && rows.length === 0 && (
              <li role="presentation" className="px-2.5 py-3 text-sm text-text-2">
                {typed ? `No customer matches “${typed}”` : "No customers yet"}
              </li>
            )}
            {onNew && (
              <li
                id={optionId(rows.length)}
                role="option"
                aria-selected={active === rows.length}
                onMouseEnter={() => setActive(rows.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(rows.length);
                }}
                className={cn(
                  "mt-1 grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg border-t border-line px-2.5 py-2 font-semibold text-primary",
                  active === rows.length && "bg-surface-2",
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
