import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@kebo/ui";
import { money, whole } from "@/lib/format";
import type { Kpi } from "@/lib/types-insights";
import { Sparkline } from "./charts";

/** The change against the period before: green when it went the good way, red when not. */
export function Change({ value, goodWhenUp = true, suffix = "%" }: { value: number | null; goodWhenUp?: boolean; suffix?: string }) {
  if (value === null) return <span className="text-xs text-muted">no comparison</span>;
  const flat = Math.abs(value) < 0.5;
  const good = flat ? null : (value > 0) === goodWhenUp;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular",
        good === null ? "bg-surface-2 text-text-2" : good ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {/* From almost nothing, the percent means little: past 999 it just says so. */}
      {flat ? "same" : Math.abs(value) >= 1000 ? `>999${suffix}` : `${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`}
    </span>
  );
}

/**
 * A headline amount for a card: whole units, and from a million as "USD 46.67M"
 * so it fits; the exact figure shows on hover.
 */
export function Headline({ amount, currency }: { amount: string | number | null | undefined; currency: string }) {
  if (amount === null || amount === undefined) return <>—</>;
  const n = Number(amount);
  const exact = whole(n, currency);
  if (Math.abs(n) < 1_000_000) return <>{exact}</>;
  return <span title={exact}>{`${currency} ${(n / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`}</span>;
}

/**
 * A KPI card: the label, the big number, the change against the period before
 * (or a note), and a small trend. Clicking it opens the list behind it.
 */
export function KpiCard({
  label,
  value,
  kpi,
  goodWhenUp = true,
  note,
  spark,
  href,
  tone,
  icon,
  points,
}: {
  label: string;
  value: ReactNode;
  kpi?: Kpi | null;
  /** A rate: show the change in points (now − before), not in percent of itself. */
  points?: boolean;
  goodWhenUp?: boolean;
  note?: ReactNode;
  spark?: number[];
  href?: string;
  tone?: "bad" | "ok" | "warn";
  icon?: ReactNode;
}) {
  const body = (
    <div className={cn("flex h-full flex-col gap-1 rounded-2xl border border-line bg-surface p-4 shadow-card transition-all", href && "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon}
        {label}
      </p>
      <p className={cn("truncate text-2xl font-semibold tracking-tight tabular", tone === "bad" && "text-bad", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{value}</p>
      <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-muted">
        {kpi !== undefined && kpi !== null && (
          <Change
            value={points ? (kpi.value === null || kpi.previous === null ? null : Math.round((Number(kpi.value) - Number(kpi.previous)) * 10) / 10) : kpi.change}
            goodWhenUp={goodWhenUp}
            suffix={points ? " pts" : "%"}
          />
        )}
        {note && <span className="truncate">{note}</span>}
      </div>
      {spark && <div className="mt-auto pt-1">{<Sparkline values={spark} tone={tone === "bad" ? "bad" : "primary"} />}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

/** How far this month's sales are towards the target, as a ring. */
export function TargetRing({ percent, reached, amount, currency, size = 132 }: { percent: number; reached: string; amount: string; currency: string; size?: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = Math.min(percent, 100);
  const tone = percent >= 100 ? "var(--ok)" : percent >= 60 ? "var(--chart-1)" : "var(--warn)";
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${percent}% of the target reached`} className="shrink-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="12" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(shown / 100) * c} ${c}`} />
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className="fill-text text-[22px] font-semibold" transform="rotate(90 60 60)">
          {percent}%
        </text>
      </svg>
      <div className="min-w-0 text-sm">
        <p className="font-medium">{money(reached, currency)}</p>
        <p className="text-muted">of {money(amount, currency)}</p>
        <p className={cn("mt-1 text-xs", percent >= 100 ? "text-ok" : "text-text-2")}>
          {percent >= 100 ? "Target reached" : `${money(Math.max(Number(amount) - Number(reached), 0), currency)} to go`}
        </p>
      </div>
    </div>
  );
}

/** Received → quoted → won, each step as a bar with how many made it from the one before. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => {
        const prev = steps[i - 1]?.value;
        return (
          <li key={s.label} className="text-sm">
            <span className="mb-1 flex items-baseline justify-between gap-3">
              <span className="font-medium">{s.label}</span>
              <span className="tabular">
                <span className="text-lg font-semibold">{s.value}</span>
                {prev !== undefined && <span className="ml-1.5 text-xs text-muted">{prev ? Math.round((s.value / prev) * 100) : 0}% of the step before</span>}
              </span>
            </span>
            <span className="block h-3 rounded-full bg-surface-2" aria-hidden>
              <span className="block h-3 rounded-full" style={{ width: `${Math.max((s.value / top) * 100, 2)}%`, background: `var(--chart-${(i % 5) + 1})` }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Rows of label · amount with a share bar. */
export function ShareBars({
  rows,
  currency,
  tone = "primary",
}: {
  /** `display`: the figure as shown, when it is not `value` in `currency` (a list in several currencies). */
  rows: { key: string; label: ReactNode; value: number; display?: ReactNode; sub?: ReactNode; href?: string }[];
  currency?: string;
  tone?: "primary" | "bad" | "warn" | "ok";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bar = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : tone === "ok" ? "bg-ok" : "bg-primary";
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="line-clamp-2 break-words">{r.label}</span>
                {r.sub && <span className="block text-xs text-muted">{r.sub}</span>}
              </span>
              <span className="shrink-0 font-medium tabular">{r.display ?? (currency ? money(r.value, currency) : r.value)}</span>
            </span>
            <span className="mt-1 block h-1.5 rounded-full bg-surface-2" aria-hidden>
              <span className={cn("block h-1.5 rounded-full", bar)} style={{ width: `${Math.max((r.value / max) * 100, 1)}%` }} />
            </span>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block rounded-lg px-2 py-1.5 hover:bg-surface-2/70">
                {inner}
              </Link>
            ) : (
              <div className="px-2 py-1.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A country code as its flag (🇵🇰 for PK). */
export const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code) && code !== "ZZ" ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌐";
