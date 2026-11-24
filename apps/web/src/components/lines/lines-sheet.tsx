import type { ReactNode } from "react";
import { cn, Dash } from "@kebo/ui";
import type { LineColumn, LineRow } from "./line-table";

/**
 * Lines read only (a step's view before "Edit lines"): a plain table of the
 * line table's columns — no tool row, nothing to click — and its totals.
 * The export lives in the card header (LinesExcel).
 */
/** A column head: the one table's (Th in @kebo/ui). */
const TH = "h-[42px] border-b border-line px-3.5 text-md font-semibold whitespace-nowrap text-muted";

export function LinesView({
  rows,
  columns,
  numbers,
  footer,
  after,
  label = "The items",
}: {
  rows: LineRow[];
  columns: LineColumn[];
  numbers: string[];
  footer?: ReactNode;
  /** One more narrow column at the end, its header said only to screen readers (a line's own history). */
  after?: { label: string; cell: (row: LineRow, i: number) => ReactNode };
  /** The box's name (it can scroll sideways, so Tab stops on it); unique on the page. */
  label?: string;
}) {
  const shown = (c: LineColumn, r: LineRow): ReactNode => {
    if (c.format) return c.format(r.values, r);
    if (c.input === "select") return c.options?.find((o) => o.value === r.values[c.key])?.label ?? r.values[c.key];
    const v = r.values[c.key];
    return v ? v : <Dash />;
  };
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      // The one table (Th, Td: live audit 20 Nov): inside its box, no frame and no lines between columns.
      className="scroll-x scroll-lg focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <table className="w-full border-collapse text-md">
        <thead className="bg-faint">
          <tr>
            <th scope="col" className={cn(TH, "w-14 pl-5 max-sm:pl-4")}>No.</th>
            {columns.map((c, k) => (
              <th
                key={c.key}
                scope="col"
                // A number's head may go onto two lines ("Unit price" / "USD") with less room around it, so the
                // description has the width (review 24 Nov, S-34: it ran to 3–4 lines beside roomy number columns).
                className={cn(
                  TH,
                  c.align === "right" ? "px-2.5 text-right leading-tight whitespace-normal" : "text-left",
                  k === 0 && "min-w-56",
                  c.phoneHidden && "max-sm:hidden",
                  c.shade && "bg-info-soft/60",
                )}
              >
                {c.label}
              </th>
            ))}
            {after && (
              <th scope="col" className={cn(TH, "w-10 px-1")}>
                <span className="sr-only">{after.label}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} aria-rowindex={i + 1} className="border-b border-line last:border-b-0">
              <td className="py-2.5 pr-3.5 pl-5 align-top text-muted tabular max-sm:pl-4">{numbers[i]}</td>
              {columns.map((c, k) => (
                <td
                  key={c.key}
                  className={cn(
                    "py-2.5 align-top",
                    c.align === "right" ? "px-2.5 text-right whitespace-nowrap tabular" : "px-3.5",
                    k === 0 && "whitespace-pre-line",
                    k === 0 && r.parentKey && "pl-7",
                    c.phoneHidden && "max-sm:hidden",
                    c.shade && "bg-info-soft/40",
                  )}
                >
                  {shown(c, r)}
                  {k === 0 && r.badge}
                </td>
              ))}
              {after && <td className="px-1 py-1 text-center align-top">{after.cell(r, i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && <div className="border-t border-line">{footer}</div>}
    </div>
  );
}
