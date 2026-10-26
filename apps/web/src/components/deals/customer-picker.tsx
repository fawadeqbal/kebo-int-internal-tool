"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";
import { Button, cn, controlClass } from "@kebo/ui";
import type { CustomerOption } from "@/lib/types-deals";

const countryText = (c: string) => (c === "ZZ" ? "Country not set" : c);

/**
 * Search-as-you-type customer picker: name, country and main contact per
 * result, keyboard friendly, with a way out to add a new customer.
 */
export function CustomerPicker({
  value,
  onChange,
  search,
  error,
  disabled,
  disabledReason,
}: {
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
  search: (q: string) => Promise<CustomerOption[]>;
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

  useEffect(() => {
    if (!open) return;
    const n = ++call.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const found = await search(q);
      if (n !== call.current) return;
      setRows(found);
      setActive(0);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, search]);

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

  if (value)
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2", error && "border-bad")}>
        <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.name}</p>
          <p className="truncate text-xs text-muted">
            {countryText(value.country)}
            {value.primaryContact ? ` · ${value.primaryContact.name}` : ""}
          </p>
        </div>
        {disabled ? (
          disabledReason && <span className="max-w-56 text-right text-xs text-muted">{disabledReason}</span>
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
        aria-activedescendant={open && rows[active] ? `${id}-${rows[active].id}` : undefined}
        autoComplete="off"
        value={q}
        placeholder="Type a company, contact, email or phone…"
        className={cn(controlClass, "h-9 pr-9 pl-9")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, rows.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && rows[active]) pick(rows[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <ul id={listId} role="listbox" aria-label="Customers" className="max-h-72 overflow-y-auto p-1">
            {rows.map((c, i) => (
              <li
                key={c.id}
                id={`${id}-${c.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === active && "bg-surface-2")}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted">{c.primaryContact ? c.primaryContact.name : "No contact"}</p>
                </div>
                <span className={cn("shrink-0 rounded bg-surface-3 px-1.5 text-xs text-text-2", c.country === "ZZ" && "bg-warn-soft text-warn")}>{countryText(c.country)}</span>
              </li>
            ))}
            {!loading && rows.length === 0 && <li className="px-2.5 py-3 text-sm text-muted">{q ? `No customer matches "${q}".` : "No customers yet."}</li>}
          </ul>
          <div className="border-t border-line px-3 py-2 text-xs text-muted">
            Not in the list?{" "}
            <Link href="/customers/new" target="_blank" className="font-medium text-primary hover:underline">
              Add a new customer
            </Link>{" "}
            (opens in a new tab), then search for it here.
          </div>
        </div>
      )}
    </div>
  );
}
