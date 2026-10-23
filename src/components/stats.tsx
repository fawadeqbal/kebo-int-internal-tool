import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Headline number tile. Links to the filtered list behind it. */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone = "default",
  size = "md",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "default" | "alert" | "good";
  size?: "md" | "sm";
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "mt-2 font-semibold tracking-tight tabular-nums",
          size === "md" ? "text-3xl" : "text-xl leading-tight whitespace-nowrap 2xl:text-2xl",
          tone === "alert" && "text-red-700",
          tone === "good" && "text-emerald-700",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-line bg-surface p-4 shadow-xs";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-brand-200 hover:bg-brand-50/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
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
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {format(item.value)}
              {item.hint && <span className="ml-1.5 text-xs font-normal text-muted">{item.hint}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-canvas" aria-hidden>
            <div className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${(item.value / max) * 100}%`, minWidth: item.value > 0 ? 4 : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
