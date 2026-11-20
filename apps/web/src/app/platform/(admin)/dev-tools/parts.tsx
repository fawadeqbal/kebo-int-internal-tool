import Link from "next/link";
import type { ReactNode } from "react";
import { DEV_LANES, type DevCheck, type DevEvent, type DevLevel, type DevTab } from "@kebo/shared";
import { Badge, cn, Notice, linkClass, capsClass, subTitleClass } from "@kebo/ui";

export const TAB_HREF: Record<DevTab, string> = {
  picture: "/platform/dev-tools",
  services: "/platform/dev-tools?tab=services",
  data: "/platform/dev-tools?tab=data",
  speed: "/platform/dev-tools?tab=speed",
  jobs: "/platform/dev-tools?tab=jobs",
  security: "/platform/dev-tools?tab=security",
  companies: "/platform/dev-tools?tab=companies",
};

const DOT: Record<DevLevel, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", off: "bg-line-strong" };
const FILL: Record<DevLevel, string> = {
  ok: "border-line bg-surface",
  warn: "border-warn/30 bg-warn-soft",
  bad: "border-bad/30 bg-bad-soft",
  off: "border-line border-dashed bg-surface",
};

export function Dot({ level, className }: { level: DevLevel; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[level], className)} />;
}

/** The level in words (colour is never the only signal). */
export function LevelBadge({ level, children }: { level: DevLevel; children?: ReactNode }) {
  const tone = level === "off" ? "neutral" : level;
  const text = children ?? (level === "bad" ? "Now" : level === "warn" ? "This week" : level === "ok" ? "Fine" : "Not set up");
  return <Badge tone={tone}>{text}</Badge>;
}

/** What needs the platform admin: now (red) first, then this week (amber), each with what to do. */
export function NeedsYou({ checks }: { checks: DevCheck[] }) {
  const needs = checks.filter((c) => c.level === "bad" || c.level === "warn").sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
  if (!needs.length)
    return (
      <Notice tone="ok" title="All good.">
        Nothing needs you. A problem shows here and is emailed to you.
      </Notice>
    );
  const now = needs.some((c) => c.level === "bad");
  return (
    <section
      aria-label="What needs you"
      className={cn("rounded-xl border px-4 py-3", now ? "border-bad/25 bg-bad-soft" : "border-warn/30 bg-warn-soft")}
      role="status"
    >
      <h2 className={subTitleClass}>
        {needs.length === 1 ? "1 thing needs you" : `${needs.length} things need you`}
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {needs.map((c) => (
          <li key={c.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <LevelBadge level={c.level} />
            <span>
              <span className="font-medium">{c.name}:</span> {c.line}.{c.fix && <span className="text-text-2"> {c.fix}</span>}
            </span>
            {c.tab !== "picture" && (
              <Link href={TAB_HREF[c.tab]} className={linkClass}>
                Open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everything watched, in the order a request travels: addresses → server → app → data → outside services. */
export function CheckMap({ checks }: { checks: DevCheck[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0 lg:px-2">
      {DEV_LANES.map((lane, n) => (
        <div key={lane.key} className={cn("flex flex-col gap-2 lg:px-2", n > 0 && "lg:border-l lg:border-dashed lg:border-line-strong")}>
          <h3 className={cn(capsClass, "flex items-center gap-1.5")}>
            <span className="grid size-[18px] place-items-center rounded-md bg-primary-soft text-2xs text-primary">{n + 1}</span>
            {lane.label}
          </h3>
          {checks
            .filter((c) => c.lane === lane.key)
            .map((c) => {
              const body = (
                <>
                  <Dot level={c.level} className="mt-1.5" />
                  <span className="min-w-0">
                    <span className="block text-md leading-[18px] font-medium">{c.name}</span>
                    <span className="block text-xs leading-4 text-text-2">{c.line}</span>
                  </span>
                </>
              );
              const cls = cn("flex items-start gap-2 rounded-lg border px-2.5 py-2", FILL[c.level]);
              return c.tab === "picture" ? (
                <div key={c.key} className={cls}>
                  {body}
                </div>
              ) : (
                <Link key={c.key} href={TAB_HREF[c.tab]} className={cn(cls, "hover:border-line-strong")}>
                  {body}
                </Link>
              );
            })}
        </div>
      ))}
    </div>
  );
}

const time = (iso: string, zone: string) =>
  new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", timeZone: zone }).replace(",", "");

export function Timeline({ events, zone }: { events: DevEvent[]; zone: string }) {
  return (
    <ul className="flex flex-col px-4 py-1">
      {events.map((e, k) => (
        <li key={`${e.at}-${k}`} className="grid grid-cols-[104px_10px_minmax(0,1fr)] items-start gap-2.5 border-b border-line py-2 text-sm last:border-b-0">
          <span className="whitespace-nowrap text-text-2 tabular">{time(e.at, zone)}</span>
          <Dot level={e.level} className="mt-1.5" />
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A line chart of a few series against time, drawn as SVG (no chart library): the series in
 * chart colours 1, 2 in that order, a legend, light grid lines, and the times below.
 */
export function LineChart({
  series,
  labels,
  max = 100,
  height = 140,
  label,
  unit = "%",
}: {
  series: { name: string; values: (number | null)[] }[];
  labels: string[];
  max?: number;
  height?: number;
  label: string;
  unit?: string;
}) {
  const W = 600;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const stroke = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3"];
  const swatch = ["bg-chart-1", "bg-chart-2", "bg-chart-3"];
  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = (i * W) / (n - 1);
      const y = height - (Math.min(v, max) / max) * height;
      d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastOf = (values: (number | null)[]) => [...values].reverse().find((v) => v !== null) ?? null;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap gap-4 text-xs text-text-2">
        {series.map((s, k) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-sm", swatch[k])} />
            {s.name}
            {lastOf(s.values) !== null && <span className="font-semibold tabular">{`${lastOf(s.values)}${unit}`}</span>}
          </span>
        ))}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="h-[140px] w-full" role="img" aria-label={label}>
        {[1, 2, 3].map((k) => (
          <line key={k} x1="0" x2={W} y1={(height * k) / 4} y2={(height * k) / 4} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, k) => (
          <path key={s.name} d={path(s.values)} fill="none" className={stroke[k]} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="flex justify-between text-2xs text-muted tabular">
        {labels.map((l, k) => (
          <span key={`${l}-${k}`}>{l}</span>
        ))}
      </div>
    </figure>
  );
}

/** A thin bar: how much of a limit is used. */
export function UseBar({ percent, className }: { percent: number; className?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-surface-3", className)} role="img" aria-label={`${Math.round(p)}% used`}>
      <span className={cn("block h-full rounded-full", p >= 90 ? "bg-bad" : p >= 75 ? "bg-warn" : "bg-primary")} style={{ width: `${p}%` }} />
    </span>
  );
}

/** Facts in a narrow card: label left, value right, one a row. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
          <dt className="text-text-2">{i.label}</dt>
          <dd className="text-right font-medium">{i.value ?? <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export const gbText = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} GB`;
export const mbText = (mb: number | null) => (mb === null ? "—" : mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${Math.round(mb)} MB`);
