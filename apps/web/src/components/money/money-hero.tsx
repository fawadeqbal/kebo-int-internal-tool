import type { ReactNode } from "react";
import { cn } from "@kebo/ui";

/**
 * A payment's amount, first and large, the same on every payment page (received, paid, expense): signed and
 * coloured by which way the money went, what it is in the main currency when it is foreign, and one line of
 * when, how and where. Who it was from or to sits on the right.
 */
export function MoneyHero({
  kind,
  direction,
  amount,
  currency,
  inMain,
  line,
  party,
  className,
}: {
  /** "Payment received", "Payment made", "Expense". */
  kind: string;
  direction: "in" | "out" | "move";
  amount: string;
  currency: string;
  inMain?: { amount: string; currency: string; rate: string } | null;
  /** "Received 24 Nov 2026 · Bank transfer (T/T) into Cash". */
  line: string;
  party?: { label: string; value: ReactNode } | null;
  className?: string;
}) {
  const tone = direction === "in" ? "text-ok" : direction === "out" ? "text-bad" : "text-text";
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const figure = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section
      aria-label={`${kind}: ${sign}${currency} ${figure(amount)}`}
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-surface px-5 py-4 shadow-card",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-bold tracking-wide uppercase", tone)}>{kind}</p>
        <p className={cn("mt-0.5 text-2xl font-extrabold tracking-tight tabular sm:text-3xl", tone)}>
          {sign && <span aria-hidden>{sign} </span>}
          {currency} {figure(amount)}
        </p>
        {inMain && (
          <p className="text-md text-text-2 tabular">
            ≈ {inMain.currency} {figure(inMain.amount)} at {Number(inMain.rate).toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
            {currency} per {inMain.currency}
          </p>
        )}
        <p className="mt-1 text-md text-text-2">{line}</p>
      </div>
      {party && (
        <div className="max-sm:basis-full sm:text-right">
          <p className="text-xs text-muted">{party.label}</p>
          <p className="text-md font-semibold text-text">{party.value}</p>
        </div>
      )}
    </section>
  );
}
