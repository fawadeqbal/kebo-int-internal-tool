import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@kebo/ui";

/** A number tile on the dashboard; links to the matching list. */
export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "warn" | "bad" | "ok" }) {
  const body = (
    <div className={cn("rounded-xl border border-line bg-surface p-4 transition-colors", href && "hover:border-line-strong")}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-text")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
