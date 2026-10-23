"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Search } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export interface CustomerOption {
  id: string;
  companyName: string | null;
  contactPerson: string;
  phone: string;
  email?: string | null;
}

/** Search-as-you-type customer picker (accessible combobox). */
export function CustomerPicker({
  name,
  initial,
  error,
  onCreateNew,
}: {
  name: string;
  initial?: CustomerOption | null;
  error?: string;
  onCreateNew?: (text: string) => void;
}) {
  const [selected, setSelected] = useState<CustomerOption | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selected) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (res.ok) {
          setResults(await res.json());
          setActive(0);
        }
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  const choose = (c: CustomerOption) => {
    setSelected(c);
    setOpen(false);
  };

  if (selected) {
    return (
      <div className={cn("flex items-center justify-between gap-3 rounded-lg border bg-primary-soft px-3 py-2.5", error ? "border-bad" : "border-primary/30")}>
        <input type="hidden" name={name} value={selected.id} />
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-primary shadow-card">
            <Building2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{selected.companyName || selected.contactPerson}</p>
            <p className="truncate text-xs text-muted">
              {selected.contactPerson} · {selected.phone}
              {selected.email ? ` · ${selected.email}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-primary hover:underline"
          onClick={() => {
            setSelected(null);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value="" />
      <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        ref={inputRef}
        id="customer-search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={!!error}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        placeholder="Name, company or phone…"
        className="pl-9"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full animate-in overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer rounded-lg px-2.5 py-2", i === active && "bg-surface-2")}
            >
              <p className="text-sm font-medium text-text">{c.companyName || c.contactPerson}</p>
              <p className="text-xs text-muted">
                {c.contactPerson} · {c.phone}
              </p>
            </li>
          ))}
          {!loading && results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matching customer.</li>}
          {onCreateNew && (
            <li className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onCreateNew(query);
                }}
                className="w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium text-primary hover:bg-primary-soft"
              >
                + Add a new customer{query ? ` “${query}”` : ""}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
