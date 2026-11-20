import type { ReactNode } from "react";
import { cn, Dash } from "@kebo/ui";

/*
 * The Dashboard frame's pieces (design system: Dashboard): the section list on the left, tiles with their
 * change against the period before, a sparkline, a segmented bar for one whole, bars for a funnel.
 */

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

/** A row of 4 tiles (2 on a phone). */
export function Tiles({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 xl:grid-cols-4", className)}>{children}</div>;
}

/** A small trend line (no axes), last point marked; the figures are in the table and Excel. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <Dash />;
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
