"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The strip above every list: search, filter chips and a result count.
 * Desktop: one row of chips. Phone: search + a "Filters" button that opens
 * the chips as a stacked panel. It is a plain GET form, so every filtered
 * view has its own URL that can be bookmarked or shared.
 */
export function FilterToolbar({
  search,
  children,
  activeCount = 0,
  end,
  hidden,
  action,
}: {
  search?: ReactNode;
  children?: ReactNode;
  activeCount?: number;
  end?: ReactNode;
  /** Params kept as they are (e.g. the status tab). */
  hidden?: Record<string, string | undefined>;
  action?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // Keep URLs tidy: leave out empty fields and default values (works without JavaScript too, just with longer URLs).
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      const value = String(v).trim();
      const field = form.elements.namedItem(k) as HTMLElement | null;
      if (value && field?.dataset?.default !== value) qs.set(k, value);
    }
    const base = action ?? pathname;
    router.push(qs.size ? `${base}?${qs}` : base);
  };
  return (
    <form role="search" action={action} onSubmit={submit} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {search && <div className="min-w-0 flex-1 md:flex-none">{search}</div>}
      {children && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-card transition-colors md:hidden",
            activeCount > 0 ? "border-primary/40 bg-primary-soft text-primary" : "border-line bg-surface text-text-2",
          )}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          Filters
          {activeCount > 0 && <span className="rounded-full bg-primary-solid px-1.5 text-[10px] leading-4 text-primary-fg tabular">{activeCount}</span>}
        </button>
      )}
      {children && (
        <div className={cn(open ? "grid w-full grid-cols-1 gap-2 pt-1" : "hidden", "md:order-last md:flex md:w-full md:flex-wrap md:items-center md:gap-2 md:pt-0")}>{children}</div>
      )}
      {end && <div className="ml-auto hidden items-center gap-2 text-xs text-muted tabular md:flex">{end}</div>}
    </form>
  );
}

const chip = (active: boolean) =>
  cn(
    "relative inline-flex h-9 w-full items-center gap-1 rounded-lg border px-2.5 text-xs shadow-card transition-colors md:h-8 md:w-auto",
    active ? "border-primary/40 bg-primary-soft text-primary" : "border-dashed border-line-strong bg-surface text-text-2 hover:bg-surface-2",
  );

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Single-choice filter chip ("Category: Beverage Machinery ▾"). A transparent
 * native select sits on top, so phones get their own picker and the keyboard
 * works as usual. Changing it applies the filter straight away.
 */
export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel = "Any",
  keepDefault,
}: {
  name: string;
  label: string;
  value?: string;
  options: FilterOption[];
  allLabel?: string;
  /** A value that is the normal state (e.g. a default sort), shown untinted. */
  keepDefault?: string;
}) {
  const current = options.find((o) => o.value === value);
  const active = !!current && current.value !== keepDefault;
  return (
    <label className={chip(active)}>
      <span className={cn("font-medium", !active && "text-muted")}>{label}</span>
      <span className={cn("min-w-0 flex-1 truncate font-semibold md:max-w-44 md:flex-none", !current && "font-medium text-text-2")}>{current ? current.label : allLabel}</span>
      <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      <select
        name={name}
        data-default={keepDefault}
        defaultValue={value ?? ""}
        aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {keepDefault === undefined && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** From–to date chip. Picking a date applies it. */
export function FilterDates({ label, from, to, fromName = "from", toName = "to" }: { label: string; from?: string; to?: string; fromName?: string; toName?: string }) {
  const active = !!(from || to);
  const input = "h-6 min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 text-xs text-text md:w-[7.4rem] md:flex-none";
  return (
    <div className={cn(chip(active), "gap-1.5 pr-1.5")} role="group" aria-label={label}>
      <span className={cn("font-medium", !active && "text-muted")}>{label}</span>
      <input type="date" name={fromName} defaultValue={from} aria-label={`${label} from`} className={input} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
      <span className="text-muted">–</span>
      <input type="date" name={toName} defaultValue={to} aria-label={`${label} to`} className={input} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
    </div>
  );
}
