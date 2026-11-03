import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@kebo/ui";

/*
 * The Dashboard frame's pieces (design system: Dashboard): the section list on the left, tiles with their
 * change against the period before, a sparkline, a segmented bar for one whole, bars for a funnel.
 */

export interface SectionItem {
  href: string;
  label: string;
  active: boolean;
  count?: number | null;
}

/** The sections, always visible: a list on the left from a laptop up (the phone has a chip row, SectionNav). */
export function SectionList({ label, items }: { label: string; items: SectionItem[] }) {
  return (
    <nav aria-label={label} className="no-print hidden self-start rounded-xl border border-line bg-surface p-2 shadow-card lg:block">
      <ul className="flex flex-col gap-0.5">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cn(
                "flex min-h-9 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                i.active ? "bg-primary-soft font-semibold text-primary" : "text-text hover:bg-surface-2",
              )}
            >
              <span>{i.label}</span>
              {i.count !== undefined && i.count !== null && (
                <span className={cn("text-xs tabular", i.active ? "text-primary" : "text-muted")}>{i.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The change against the period before: an arrow and the size, coloured by whether it went the good way
 * (never by sign alone), with the words for screen readers.
 */
export function Delta({
  value,
  goodWhenUp = true,
  points,
  vs,
}: {
  value: number | null;
  goodWhenUp?: boolean;
  points?: boolean;
  vs: string;
}) {
  if (value === null || !Number.isFinite(value)) return null;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const good = flat ? null : up === goodWhenUp;
  const size = Math.abs(value) >= 1000 ? ">999" : Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const unit = points ? " pts" : "%";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular",
        good === null ? "text-muted" : good ? "text-ok" : "text-bad",
      )}
    >
      <span aria-hidden>{flat ? "=" : up ? "▲" : "▼"}</span>
      <span aria-hidden>{flat ? "same" : `${size}${unit}`}</span>
      <span className="sr-only">
        {flat ? `the same as ${vs}` : `${up ? "up" : "down"} ${size}${points ? " points" : " percent"} on ${vs}`}
      </span>
    </span>
  );
}

/** One headline figure: label and change on top, the value, one line of context, and an optional meter. */
export function Tile({
  label,
  value,
  delta,
  sub,
  meter,
  className,
  href,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  sub?: ReactNode;
  /** The share of the value that is bad (overdue), drawn as a thin bar. */
  meter?: { percent: number; label: string };
  className?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-text-2">{label}</span>
        {delta}
      </span>
      <span className="truncate text-xl leading-7 font-semibold tracking-tight sm:text-2xl">{value}</span>
      {meter && (
        <span className="block h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={meter.label}>
          <span className="block h-full rounded-full bg-chart-3" style={{ width: `${Math.max(0, Math.min(100, meter.percent))}%` }} />
        </span>
      )}
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  const cls = cn("flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card", className);
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-line-strong")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A row of 4 tiles (2 on a phone). */
export function Tiles({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 xl:grid-cols-4", className)}>{children}</div>;
}

/** A small trend line (no axes), last point marked; the figures are in the table and Excel. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="text-muted">—</span>;
  const w = 88;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="overflow-visible">
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--chart-1)" />
    </svg>
  );
}

/** One-hue ramp, light to dark: for ordered parts (not due → over 60 days). */
export const RAMP = [
  "color-mix(in oklab, var(--chart-1) 22%, var(--surface))",
  "color-mix(in oklab, var(--chart-1) 45%, var(--surface))",
  "color-mix(in oklab, var(--chart-1) 75%, var(--surface))",
  "color-mix(in oklab, var(--chart-1) 100%, black 18%)",
];

/**
 * One whole split into ordered parts (owed by age): a thin segmented bar, then each part's name and amount
 * under its swatch. A part can link to its list.
 */
export function SegmentBar({
  label,
  total,
  parts,
}: {
  label: string;
  total: ReactNode;
  parts: { key: string; label: string; value: number; text: string; href?: string; active?: boolean }[];
}) {
  const sum = parts.reduce((t, p) => t + Math.max(0, p.value), 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-text-2">Total</span>
        <span className="font-semibold tabular">{total}</span>
      </div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.text}`).join(", ")}`}
      >
        {sum > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span
                key={p.key}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(p.value / sum) * 100}%`, background: RAMP[parts.indexOf(p)] }}
              />
            ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        {parts.map((p, i) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5 text-xs text-text-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: RAMP[i] }} />
                {p.label}
              </span>
              <span className="text-sm font-semibold tabular">{p.text}</span>
            </>
          );
          return (
            <li key={p.key}>
              {p.href ? (
                <Link
                  href={p.href}
                  scroll={false}
                  aria-current={p.active ? "true" : undefined}
                  className={cn(
                    "-m-1 flex flex-col gap-0.5 rounded-md p-1 hover:bg-surface-2",
                    p.active && "bg-primary-soft ring-1 ring-primary/40",
                  )}
                >
                  {body}
                </Link>
              ) : (
                <div className="flex flex-col gap-0.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars, one hue, the value at the end and an optional second line under the name. */
export function BarList({
  label,
  rows,
  tone = "chart-1",
}: {
  label: string;
  rows: { key: string; label: string; sub?: string; value: number; text: string }[];
  tone?: "chart-1" | "chart-3" | "chart-4";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fill = tone === "chart-3" ? "bg-chart-3" : tone === "chart-4" ? "bg-chart-4" : "bg-chart-1";
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]"
        >
          <span className="min-w-0">
            <span className="block truncate">{r.label}</span>
            {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
          </span>
          <span className="h-2.5 rounded-full bg-surface-3">
            <span className={cn("block h-full rounded-full", fill)} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="text-right font-semibold tabular">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A small heading over a group of cards ("The same figures on each customer's page"). */
export function GroupHeading({ children }: { children: ReactNode }) {
  return <h2 className="mt-1 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>;
}
