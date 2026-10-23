"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Search } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export interface CustomerOption {
  id: string;
  companyName: string;
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
      <div className={cn("flex items-center justify-between gap-3 rounded-lg border bg-brand-50/50 px-3 py-2.5", error ? "border-red-500" : "border-brand-200")}>
        <input type="hidden" name={name} value={selected.id} />
        <div className="flex min-w-0 items-center gap-3">
          <Building2 className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{selected.companyName}</p>
            <p className="truncate text-xs text-muted">
              {selected.contactPerson} · {selected.phone}
              {selected.email ? ` · ${selected.email}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-brand-700 hover:underline"
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
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
      <Input
        ref={inputRef}
        id="customer-search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={!!error}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        placeholder="Search by company, contact person or phone…"
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
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
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
              className={cn("cursor-pointer px-3 py-2", i === active && "bg-brand-50")}
            >
              <p className="text-sm font-medium">{c.companyName}</p>
              <p className="text-xs text-muted">
                {c.contactPerson} · {c.phone}
              </p>
            </li>
          ))}
          {!loading && results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matching customer.</li>}
          {onCreateNew && (
            <li className="border-t border-line">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onCreateNew(query);
                }}
                className="w-full px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
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
