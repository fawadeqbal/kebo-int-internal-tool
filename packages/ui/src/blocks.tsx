import Link from "next/link";

import { Children, isValidElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { HowMade } from "./primitives";

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

/* ---------------------------------------------------------------- StatTile, Meter, RankedBars */

const ICON_BG = { 1: "bg-chart-1", 2: "bg-chart-2", 3: "bg-chart-3", 4: "bg-chart-4", 5: "bg-chart-5" } as const;

/** One fact of a list's facts line: its words, its figure, a grey word after it, red when it is bad, a link. */
export interface Fact {
  label: ReactNode;
  value: ReactNode;
  /** After the value, in grey ("9 quotations", "this year"). */
  sub?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  href?: string;
}

/**
 * The one facts line of a list page (canvas board "One list page for all 25 lists": facts, not tiles): one slim line
 * with only what the tabs do not already say, a figure each, never a big card per number. Not on a phone: there
 * the tabs and the rows are the page.
 */
export function FactsLine({ facts, className }: { facts: Fact[]; className?: string }) {
  if (!facts.length) return null;
  return (
    <dl aria-label="Facts" className={cn("flex min-h-[46px] flex-wrap items-center rounded-xl border border-line bg-surface px-1.5 py-1.5 max-sm:hidden", className)}>
      {facts.map((f, i) => {
        return (
          <div key={i} className={cn("flex items-baseline gap-1.5 px-3.5 text-md whitespace-nowrap text-muted", i > 0 && "border-l border-line")}>
            <dt>{f.label}</dt>
            <dd className={cn("text-sm font-bold text-text tabular", f.tone === "bad" && "text-bad", f.tone === "warn" && "text-warn")}>
              {f.href ? (
                <Link href={f.href} className="hover:underline">
                  {f.value}
                </Link>
              ) : (
                f.value
              )}
            </dd>
            {f.sub && <dd>{f.sub}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Tiles in a row of 3–6 (Home, reports, a record's figures). `facts`: a list page's figures — drawn as the one
 * FactsLine from the tiles' label, value, line and link, so every list says its figures the same way.
 */
export function StatRow({ children, className, facts }: { children: ReactNode; className?: string; facts?: boolean }) {
  if (facts) {
    const list = Children.toArray(children)
      .filter(isValidElement)
      .map((el) => {
        const p = el.props as { label: ReactNode; value: ReactNode; sub?: ReactNode; also?: ReactNode; tone?: Fact["tone"]; href?: string };
        return { label: p.label, value: p.value, sub: p.sub ?? p.also, tone: p.tone === "ok" ? undefined : p.tone, href: p.href };
      });
    return <FactsLine facts={list} className={className} />;
  }
  return <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]", className)}>{children}</div>;
}

/**
 * One headline figure: the only tile in the app (dashboard, reports, records, platform).
 * Label with its change top right, the value (coloured by `tone` when it means something),
 * an optional bar, one line of context. `href` makes the whole tile a link to the list behind
 * the number. `size="sm"` is for five or more in a row and for tiles inside a card.
 */
export function StatTile({
  label,
  value,
  also,
  sub,
  delta,
  tone,
  href,
  meter,
  bar,
  size = "md",
  icon: Icon,
  iconColor = 1,
  className,
  how,
  howTitle,
}: {
  label: ReactNode;
  value: ReactNode;
  /** The value's other parts, named, right under it: the other currencies ("and USD 12,400"), never "+1". */
  also?: ReactNode;
  /** One line of context under the value. */
  sub?: ReactNode;
  /** The change against the period before (Delta), top right. */
  delta?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  href?: string;
  /** The share of the value that is bad (overdue), as a thin bar. */
  meter?: { percent: number; label: string };
  /** A bar of the caller's own (use of a limit), between the value and the context line. */
  bar?: ReactNode;
  size?: "sm" | "md";
  /** A coloured tile with an icon on the left (the dashboard's figures). */
  icon?: LucideIcon;
  /** The tile's colour: one of the chart colours (1 green, 2 orange, 3 blue, 4 violet, 5 teal). */
  iconColor?: 1 | 2 | 3 | 4 | 5;
  className?: string;
  /** How the figure is worked out, behind an ⓘ in the tile's corner (HowMade): every figure of Home and Reports has one. */
  how?: string;
  /** The ⓘ note's heading when the label is not plain text. */
  howTitle?: string;
}) {
  const figure = (
    <>
      <span data-stat-label="" className={cn("flex items-start justify-between gap-2", how && "pr-6")}>
        <span className="text-xs text-muted">{label}</span>
        {delta}
      </span>
      <span
        data-stat-value=""
        title={typeof value === "string" ? value : undefined}
        className={cn(
          "truncate font-bold tracking-tight tabular",
          size === "sm" ? "text-lg sm:text-xl" : "text-xl leading-7 sm:text-xl",
        )}
      >
        {value}
      </span>
      {also && (
        <span data-stat-more="" className="truncate text-xs font-medium text-text-2">
          {also}
        </span>
      )}
      {meter && (
        <span data-stat-more="" className="block h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={meter.label}>
          <span className="block h-full rounded-full bg-chart-3" style={{ width: `${Math.max(0, Math.min(100, meter.percent))}%` }} />
        </span>
      )}
      {bar && <span data-stat-more="">{bar}</span>}
      {sub && <span data-stat-sub={tone === "bad" || tone === "warn" ? "news" : ""} className={cn("text-xs", tone === "bad" ? "font-semibold text-bad" : tone === "warn" ? "font-semibold text-action" : tone === "ok" ? "font-semibold text-ok" : "text-muted")}>{sub}</span>}
    </>
  );
  const body = Icon ? (
    <span data-stat-body="" className="flex min-w-0 items-start gap-3">
      <span className={cn("hidden size-[42px] shrink-0 place-items-center rounded-xl text-white sm:grid", ICON_BG[iconColor])} aria-hidden>
        <Icon className="size-5" />
      </span>
      <span data-stat-figure="" className={cn("flex min-w-0 flex-1 flex-col", size === "sm" ? "gap-0.5" : "gap-1")}>
        {figure}
      </span>
    </span>
  ) : (
    figure
  );
  const cls = cn(
    "flex h-full min-w-0 flex-col rounded-[14px] border bg-surface",
    tone === "bad" ? "border-bad/30" : "border-line",
    size === "sm" ? "gap-0.5 px-4 py-3" : "gap-0.5 px-4 py-3.5",
    className,
  );
  const tile = href ? (
    <Link data-stat="" href={href} className={cn(cls, "transition-colors hover:border-line-strong")}>
      {body}
    </Link>
  ) : (
    <div data-stat="" className={cls}>
      {body}
    </div>
  );
  if (!how) return tile;
  // The ⓘ sits on the tile, beside it in the page (a button may not be inside the tile's link).
  return (
    <div data-stat-how="" className="relative h-full min-w-0">
      {tile}
      <HowMade
        title={howTitle ?? (typeof label === "string" ? label : "This figure")}
        rule={how}
        className={cn("absolute right-2.5", size === "sm" ? "top-2" : "top-2.5")}
      />
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
  /** After the label: a short status in a small grey pill ("Written", "No offers", "R2 draft"). */
  tag?: string;
}

/* ---------------------------------------------------------------- SectionList (Settings frame) */

/**
 * The Settings frame (design system: page frames · Settings): a list of the
 * module's sections, always visible — down the left from a laptop up, a row
 * of chips that scrolls sideways on a phone and a tablet, the current one
 * filled — and the section's cards beside it.
 */
export function SectionList({
  label,
  items,
  children,
  wide,
  boxed,
  className,
}: {
  label: string;
  items: SectionNavItem[];
  children: ReactNode;
  /** Sections with tables: the cards take the whole width (otherwise a readable column). */
  wide?: boolean;
  /** The list down the left sits in a card (a record's sections, beside cards). */
  boxed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6", className)}>
      <nav aria-label={label} className={cn("no-print lg:sticky lg:top-20", boxed && "lg:rounded-xl lg:border lg:border-line lg:bg-surface lg:p-2 lg:shadow-card")}>
        <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
          {items.map((l) => (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={l.active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-md font-medium whitespace-nowrap lg:h-auto lg:rounded-md lg:px-2.5 lg:py-1.5 lg:text-sm",
                  l.active ? "bg-primary-soft font-semibold text-primary" : "bg-surface-2 text-text-2 hover:text-text lg:bg-transparent lg:font-normal lg:hover:bg-surface-2",
                )}
              >
                {l.mark}
                <span>{l.label}</span>
                {l.count !== undefined && l.count !== null && l.count !== "" && (
                  <span className={cn("ml-auto text-2xs tabular", l.alert ? "text-bad" : "text-muted")}>{l.count}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={cn("flex min-w-0 flex-col gap-4", !wide && "max-w-3xl")}>{children}</div>
    </div>
  );
}

