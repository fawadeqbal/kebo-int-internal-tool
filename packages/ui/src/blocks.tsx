import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, Plus } from "lucide-react";
import { cn } from "./cn";

/*
 * Building blocks from the RFQ Desk design system
 * (https://claude.ai/artifact/VyarwgZ53b9SQ2EhEaTYa8): one component per job,
 * so every screen shows the same thing the same way.
 */

/* ---------------------------------------------------------------- ChecksBox */

export interface CheckItem {
  key: string;
  text: ReactNode;
  /** A button (xs, secondary) that goes to the fix. */
  action?: ReactNode;
}

/**
 * What is still missing before a record is ready ("2 things to finish this
 * offer", "Before you send R1"), or, with no items, a green line that it is.
 */
export function ChecksBox({ title, items, ready, className }: { title: ReactNode; items: CheckItem[]; ready?: ReactNode; className?: string }) {
  if (!items.length)
    return ready ? (
      <p role="status" className={cn("flex items-start gap-2 rounded-xl border border-ok/30 bg-ok-soft px-3 py-2.5 text-sm", className)}>
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        <span>{ready}</span>
      </p>
    ) : null;
  return (
    <div role="status" className={cn("flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn-soft/60 p-3 sm:px-4", className)}>
      <p className="flex items-center gap-2 text-sm font-semibold text-warn">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> {title}
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">{i.text}</span>
            {i.action}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- DetailGrid */

export interface DetailItem {
  label: string;
  value: ReactNode;
  /** Missing and needed: warn fill, `warn` text in place of the value. */
  warn?: string;
  /** Hidden when empty (no "+ Add" box), e.g. for read-only viewers. */
  hideEmpty?: boolean;
}

/**
 * A record's facts at a glance: small boxes, label above value. With
 * `onEdit`, every box is a button that opens the record's details form and an
 * empty one says "+ Add"; without it they are plain and empty ones are hidden.
 */
export function DetailGrid({ items, onEdit, className }: { items: DetailItem[]; onEdit?: () => void; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6", className)}>
      {items.map((f) => {
        const empty = f.value === null || f.value === undefined || f.value === "";
        if (empty && !f.warn && (!onEdit || f.hideEmpty)) return null;
        const body = (
          <>
            <span className="block text-xs text-muted">{f.label}</span>
            <span className={cn("line-clamp-2 block text-sm font-medium break-words", empty ? (f.warn ? "text-warn" : "text-primary") : "text-text")}>
              {empty ? (f.warn ?? "+ Add") : f.value}
            </span>
          </>
        );
        const cls = cn(
          "min-w-0 rounded-lg border px-3 py-2 text-left",
          empty && f.warn ? "border-warn/30 bg-warn-soft/50" : empty ? "border-dashed border-line-strong bg-surface" : "border-line bg-surface-2/50",
        );
        return onEdit ? (
          <button key={f.label} type="button" onClick={onEdit} className={cn(cls, "hover:border-primary/50")} title={`Change ${f.label.toLowerCase()}`}>
            {body}
          </button>
        ) : (
          <div key={f.label} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- SelectCard */

/** A row of SelectCards: scrolls sideways on phones and laptops, a column beside its panel from 1536px when `column`. */
export function SelectCardList({ label, children, column, className }: { label: string; children: ReactNode; column?: boolean; className?: string }) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pt-0.5 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0.5",
        column && "2xl:flex-col 2xl:overflow-visible 2xl:pb-0",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/**
 * One item of a short list you pick from to work on (a factory offer, a
 * quotation option): name and its key figure, one meta line, status badges.
 */
export function SelectCard({
  title,
  figure,
  meta,
  badges,
  selected,
  onSelect,
  wide,
}: {
  title: ReactNode;
  figure?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  /** Fills the column (when the list is a column). */
  wide?: boolean;
}) {
  return (
    <li className={cn("w-64 shrink-0 snap-start", wide && "2xl:w-auto")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex h-full w-full flex-col items-start gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
          selected ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
        )}
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="min-w-0 font-semibold break-words">{title}</span>
          {figure !== undefined && <span className="shrink-0 text-sm font-semibold tabular">{figure}</span>}
        </span>
        {meta && <span className="text-xs text-text-2">{meta}</span>}
        {badges && <span className="flex flex-wrap gap-1.5">{badges}</span>}
      </button>
    </li>
  );
}

/**
 * The dashed "Add …" card that ends a SelectCard list, with an optional small
 * line under it ("2 more offers to add"). `expanded`: it opens a list (a
 * disclosure, announced as such) rather than toggling a state.
 */
export function AddCard({
  children,
  hint,
  onClick,
  pressed,
  expanded,
  wide,
}: {
  children: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  expanded?: boolean;
  wide?: boolean;
}) {
  const on = pressed ?? expanded;
  return (
    <li className={cn("w-48 shrink-0 snap-start", wide && "2xl:w-auto")}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={expanded === undefined ? pressed : undefined}
        aria-expanded={expanded}
        className={cn(
          "flex h-full min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl border-[1.5px] border-dashed px-3 py-3 text-sm font-semibold text-primary",
          on ? "border-primary bg-primary-soft" : "border-primary/40 bg-surface hover:border-primary",
        )}
      >
        <span className="flex items-center gap-2">
          <Plus className="size-4" aria-hidden /> {children}
        </span>
        {hint && <span className="text-xs font-normal text-text-2">{hint}</span>}
      </button>
    </li>
  );
}

/* ---------------------------------------------------------------- StatTile, Meter, RankedBars */

/** Tiles in a row of 3–6. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]", className)}>{children}</div>;
}

/** One headline number, its change in words (coloured by meaning, not by sign) and one line of context. */
export function StatTile({ label, value, delta, tone }: { label: ReactNode; value: ReactNode; delta?: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="truncate text-xl font-semibold tracking-tight tabular sm:text-2xl">{value}</span>
      {delta && <span className={cn("text-xs font-medium", tone === "up" ? "text-ok" : tone === "down" ? "text-bad" : "text-muted")}>{delta}</span>}
    </div>
  );
}

/** Progress to one target. */
export function Meter({ label, figure, percent, hint, tone }: { label: ReactNode; figure?: ReactNode; percent: number; hint?: ReactNode; tone?: "ok" | "warn" }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="flex flex-col gap-1.5">
      {(label || figure) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{label}</span>
          {figure && <span className="tabular">{figure}</span>}
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={typeof label === "string" ? label : undefined}>
        <span className={cn("block h-full rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-primary")} style={{ width: `${p}%` }} />
      </div>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** "Which is biggest": one hue, longest first, the value written at the end. */
export function RankedBars({ rows, label }: { rows: { key: string; label: ReactNode; value: number; text: ReactNode }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-3">
            <span className="block h-3 rounded-r bg-chart-1" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="text-right tabular">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- ProgressSteps, Tracker */

export type StepState = "done" | "current" | "attention" | "todo";

/** Where an order is in the flow: one segment per stage, each linking to its tab. */
export function ProgressSteps({ steps, label = "Progress" }: { steps: { key: string; label: string; sub?: ReactNode; state: StepState; href?: string }[]; label?: string }) {
  return (
    <nav aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0">
      {steps.map((s) => {
        const inner = (
          <>
            <span
              className={cn(
                "block h-1 rounded-full",
                s.state === "done" ? "bg-ok" : s.state === "current" ? "bg-primary" : s.state === "attention" ? "bg-warn" : "bg-line",
              )}
            />
            <span className={cn("block text-xs font-medium", s.state === "current" ? "font-semibold text-text" : s.state === "attention" ? "font-semibold text-warn" : s.state === "done" ? "text-text-2" : "text-muted")}>
              {s.label}
            </span>
            {s.sub && <span className="block text-xs text-muted">{s.sub}</span>}
          </>
        );
        const cls = "flex min-w-28 flex-1 flex-col gap-1.5";
        return s.href ? (
          <Link key={s.key} href={s.href} className={cn(cls, "hover:opacity-80")} aria-current={s.state === "current" ? "step" : undefined}>
            {inner}
          </Link>
        ) : (
          <div key={s.key} className={cls}>
            {inner}
          </div>
        );
      })}
    </nav>
  );
}

/** Steps that happen outside the app, one after another (banks, delivery): a dot and a line each; only the current one has a button. */
export function Tracker({ steps, label }: { steps: { key: string; title: ReactNode; sub?: ReactNode; state: StepState; side?: ReactNode }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.key} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 pb-4 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className={cn("absolute top-6.5 bottom-0.5 left-[11px] w-0.5", s.state === "done" ? "bg-ok" : "bg-line")} />}
          <span
            aria-hidden
            className={cn(
              "grid size-6 place-items-center rounded-full border-2 text-white",
              s.state === "done" ? "border-ok bg-ok" : s.state === "current" ? "border-primary bg-primary-soft" : s.state === "attention" ? "border-warn bg-warn-soft" : "border-line-strong bg-surface",
            )}
          >
            {s.state === "done" && <Check className="size-3.5" strokeWidth={3} />}
          </span>
          <span className="min-w-0">
            <span className={cn("block text-sm", s.state === "current" ? "font-semibold" : s.state === "todo" ? "text-text-2" : "font-medium")}>{s.title}</span>
            {s.sub && <span className="block text-xs text-muted">{s.sub}</span>}
          </span>
          <span className="flex items-start">{s.side}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- SectionNav */

export interface SectionNavItem {
  href: string;
  label: ReactNode;
  active: boolean;
  /** Before the label: a step's tick or number (StepMark). */
  mark?: ReactNode;
  /** After the label: a count or progress ("3/5", "8"), with words for screen readers inside if needed. */
  count?: ReactNode;
  /** The count in red (late). */
  alert?: boolean;
}

/**
 * Where you are in a record or a module, always visible (design system:
 * section navigation): numbered steps (orders, inquiries) or a list of
 * sections (Insights, Settings), with counts that show progress. From a
 * tablet up, a row of links on a line; on a phone, a row of chips that
 * scrolls sideways with the current one filled (`phone="chips"`), or nothing
 * when the page has its own phone picker (`phone="none"`).
 */
export function SectionNav({
  label,
  items,
  phone = "chips",
  className,
}: {
  label: string;
  items: SectionNavItem[];
  phone?: "chips" | "none";
  className?: string;
}) {
  return (
    <>
      <nav aria-label={label} className={cn("no-print hidden border-b border-line md:block", className)}>
        <ul className="relative -mb-px flex gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((l) => (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={l.active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-2 py-2.5 text-sm whitespace-nowrap transition-colors xl:px-2.5",
                  l.active ? "border-primary font-semibold text-text" : "border-transparent text-text-2 hover:text-text",
                )}
              >
                {l.mark}
                <span>{l.label}</span>
                {l.count !== undefined && l.count !== null && l.count !== "" && (
                  <span className={cn("text-[11px] tabular", l.alert ? "text-bad" : "text-muted")}>{l.count}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {phone === "chips" && (
        <nav aria-label={label} className={cn("no-print -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden", className)}>
          {items.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap",
                l.active ? "bg-primary-soft font-semibold text-primary" : "bg-surface-2 text-text-2 hover:text-text",
              )}
            >
              {l.label}
              {l.count !== undefined && l.count !== null && l.count !== "" && <span className={cn("tabular", l.alert && "text-bad")}>{l.count}</span>}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- StickyBar */

/** Save and Cancel of a long form, kept in view; above the phone's bottom bar. */
export function StickyBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-pop backdrop-blur lg:bottom-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
