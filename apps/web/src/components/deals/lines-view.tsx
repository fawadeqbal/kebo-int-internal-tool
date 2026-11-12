"use client";

import { ExcelMenu } from "@/components/sheets/excel-menu";
import { lineExport } from "@/components/sheets/line-sheets";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import { cn } from "@kebo/ui";
import type { ReactNode } from "react";

/**
 * Lines read only (a step's view before "Edit lines"): a plain table of the
 * line table's columns — no tool row, nothing to click — and its totals.
 * The export lives in the card header (LinesExcel).
 */
export function LinesView({
  rows,
  columns,
  numbers,
  footer,
  label = "The lines",
}: {
  rows: LineRow[];
  columns: LineColumn[];
  numbers: string[];
  footer?: ReactNode;
  /** The box's name (it can scroll sideways, so Tab stops on it); unique on the page. */
  label?: string;
}) {
  const shown = (c: LineColumn, r: LineRow): ReactNode => {
    if (c.format) return c.format(r.values, r);
    if (c.input === "select") return c.options?.find((o) => o.value === r.values[c.key])?.label ?? r.values[c.key];
    const v = r.values[c.key];
    return v ? v : <span className="text-muted">—</span>;
  };
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="overflow-x-auto rounded-lg border border-line focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-xs text-text-2">
            <th className="w-12 border-b border-line px-2 py-2 text-left font-medium">No.</th>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "border-b border-l border-line px-2 py-2 font-medium whitespace-nowrap",
                  c.align === "right" ? "text-right" : "text-left",
                  c.phoneHidden && "max-sm:hidden",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} aria-rowindex={i + 1} className="border-b border-line last:border-b-0">
              <td className="px-2 pt-[0.6rem] pb-2 align-top text-xs text-muted tabular">{numbers[i]}</td>
              {columns.map((c, k) => (
                <td
                  key={c.key}
                  className={cn(
                    "border-l border-line px-2 py-2 align-top",
                    c.align === "right" ? "text-right whitespace-nowrap tabular" : "",
                    k === 0 && "whitespace-pre-line",
                    k === 0 && r.parentKey && "pl-5",
                    c.phoneHidden && "max-sm:hidden",
                  )}
                >
                  {shown(c, r)}
                  {k === 0 && r.badge}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && <div className="border-t border-line">{footer}</div>}
    </div>
  );
}

/** The lines as an Excel file (the same export as the line table's Excel menu), for a card header. */
export function LinesExcel({ name, rows, columns, numbers, noun = "lines" }: { name: string; rows: LineRow[]; columns: LineColumn[]; numbers: string[]; noun?: string }) {
  if (!rows.length) return null;
  return <ExcelMenu noun={noun} exportSheet={() => lineExport({ name, columns, rows, numbers })} />;
}
