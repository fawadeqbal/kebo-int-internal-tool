import type { ReactNode } from "react";
import { cn, RULES } from "@kebo/ui";

/** One line of the totals: its label and amount; `big` is the total, `quiet` a line under it (≈ in USD). */
export interface TotalsRow {
  label: ReactNode;
  value: ReactNode;
  big?: boolean;
  quiet?: boolean;
  /** Said in red (a loss). */
  bad?: boolean;
}

/**
 * The one totals block under a record's items (canvas board "What changes, piece by piece"): Before tax · Tax ·
 * Total with tax (or Total · no tax) on the right, and above them a shaded "Ours only" strip — our cost, and on a
 * quotation the profit and the margin — only for people who see costs.
 */
export function Totals({ rows, ours, label = "Totals" }: { rows: TotalsRow[]; ours?: TotalsRow[] | null; label?: string }) {
  const line = "flex items-baseline justify-between gap-4";
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2.5 py-2.5">
      {ours && ours.length > 0 && (
        // A strip across the box at its inset (not a rounded box inside it), like BoxNote.
        <div className={cn(RULES.box.inset, "flex flex-wrap items-baseline gap-x-5 gap-y-1 bg-info-soft/60 py-2 text-md")}>
          <p className="font-semibold text-text-2 max-sm:w-full">Ours only</p>
          <dl aria-label="Ours only" className="contents">
            {ours.map((o, i) => (
              <div key={i} className="flex items-baseline gap-1.5">
                <dt className="text-text-2">{o.label}</dt>
                <dd className={cn("font-semibold tabular", o.bad ? "text-bad" : "text-text")}>{o.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <dl className={cn(RULES.box.inset, "ml-auto flex w-full max-w-[24rem] flex-col gap-1 text-sm")}>
        {rows.map((r, i) =>
          r.quiet ? (
            <div key={i} className="text-right text-xs text-text-2 tabular">
              <dt className="sr-only">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ) : (
            <div key={i} className={cn(line, r.big && "font-bold text-text", r.big && i > 0 && "mt-0.5 border-t border-line pt-1.5")}>
              <dt className={r.big ? undefined : "text-text-2"}>{r.label}</dt>
              <dd className={cn("tabular", r.big && "text-lead", r.bad && "text-bad")}>{r.value}</dd>
            </div>
          ),
        )}
      </dl>
    </div>
  );
}
