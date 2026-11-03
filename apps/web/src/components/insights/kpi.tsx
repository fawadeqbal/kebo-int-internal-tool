import { cn } from "@kebo/ui";
import { money } from "@/lib/format";

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
