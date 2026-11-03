"use client";

import { useState, type ReactNode } from "react";
import { Card, CardHeader, cn } from "@kebo/ui";

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
  /** Columns after the first are numbers (right-aligned) unless said otherwise. */
  textColumns?: number[];
}

/**
 * A chart in a card, with its "Table" twin: the same figures as a table, one click away (and for screen
 * readers). The chart's own hover tooltip shows each month; the table shows them all.
 */
export function ChartCard({
  title,
  description,
  table,
  children,
  className,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  table: ChartTable;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <button
              type="button"
              aria-pressed={asTable}
              onClick={() => setAsTable((v) => !v)}
              className="no-print inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-text-2 hover:bg-surface-2 hover:text-text aria-pressed:bg-surface-2 aria-pressed:text-text"
            >
              {asTable ? "Chart" : "Table"}
            </button>
          </>
        }
      />
      <div className="p-4">{asTable ? <FiguresTable table={table} /> : children}</div>
    </Card>
  );
}

function FiguresTable({ table }: { table: ChartTable }) {
  const text = new Set([0, ...(table.textColumns ?? [])]);
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Figures">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  "h-9 border-b border-line px-3 text-xs font-medium whitespace-nowrap text-muted first:pl-0 last:pr-0",
                  text.has(i) ? "text-left" : "text-right",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, n) => (
            <tr key={n} className="last:[&>td]:border-b-0">
              {r.map((v, i) => (
                <td
                  key={i}
                  className={cn(
                    "h-10 border-b border-line px-3 whitespace-nowrap first:pl-0 last:pr-0",
                    text.has(i) ? "text-left" : "text-right tabular",
                  )}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
