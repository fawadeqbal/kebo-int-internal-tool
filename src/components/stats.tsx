import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const TONES = {
  neutral: "bg-surface-2 text-text-2",
  primary: "bg-primary-soft text-primary",
  trust: "bg-trust-soft text-trust",
  money: "bg-money-soft text-money",
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
} as const;

export type StatTone = keyof typeof TONES;

/** One KPI: label, big number, a line of context. Clickable when `href` is set. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  href?: string;
  /** Draw attention (e.g. a queue that needs someone). */
  emphasis?: boolean;
}) {
  const body = (
    <div className={cn("h-full rounded-xl border border-line bg-surface p-4 shadow-card transition-colors", href && "hover:border-line-strong", emphasis && "border-warn/40")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon && (
          <span className={cn("flex size-7 items-center justify-center rounded-lg", TONES[tone])}>
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-text tabular">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A label/value row inside a card (icon, label, number, small note). */
export function Metric({ icon: Icon, label, value, sub, warn, href }: { icon: LucideIcon; label: string; value: ReactNode; sub?: ReactNode; warn?: boolean; href?: string }) {
  const inner = (
    <>
      <Icon className={cn("size-4 shrink-0 text-muted", warn && "text-warn")} aria-hidden />
      <span className="flex-1 text-sm text-text-2">{label}</span>
      <span className="text-right">
        <span className={cn("block text-sm font-semibold text-text tabular", warn && "text-warn")}>{value}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
      {inner}
    </Link>
  ) : (
    <div className="flex items-center gap-3 py-2.5">{inner}</div>
  );
}

/** A work queue link: tinted when something is waiting. */
export function Queue({ href, label, count, danger, more }: { href: string; label: string; count: number; danger?: boolean; /** The count is a capped sample: show "6+". */ more?: boolean }) {
  const has = count > 0;
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm transition-colors hover:border-line-strong hover:bg-surface-2",
        has && (danger ? "border-bad/30 bg-bad-soft/40" : "border-warn/30 bg-warn-soft/40"),
      )}
    >
      <span className="flex-1 text-text">{label}</span>
      <span className={cn("font-semibold tabular", has ? (danger ? "text-bad" : "text-warn") : "text-muted")}>
        {count}
        {more && "+"}
      </span>
    </Link>
  );
}

/** Horizontal bars for a handful of labelled values (single hue; numbers always shown). */
export function BarList({ items, format = (n) => String(n) }: { items: { label: string; value: number; hint?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="text-sm text-muted">Nothing in this period.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-text-2">{item.label}</span>
            <span className="shrink-0 font-semibold text-text tabular">
              {format(item.value)}
              {item.hint && <span className="ml-1.5 text-xs font-normal text-muted">{item.hint}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-3" aria-hidden>
            <div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${(item.value / max) * 100}%`, minWidth: item.value > 0 ? 4 : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
