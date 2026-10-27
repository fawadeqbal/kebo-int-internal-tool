"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@kebo/ui";

export interface SheetColumn<R> {
  key: string;
  label: string;
  /** e.g. "6rem"; empty: takes the rest. */
  width?: string;
  align?: "right";
  /** Typed into (a number or a short text); without it the column is shown only. */
  input?: "number" | "text";
  maxLength?: number;
  /** What a shown-only column displays. */
  show?: (row: R) => ReactNode;
  /** The value a typed column holds. */
  value?: (row: R) => string;
  /** Label for screen readers: "Packages for line 2". */
  aria?: (row: R) => string;
}

/**
 * A small sheet for a form (the packing list, goods that came in): bordered
 * cells, row numbers, typed columns as boxes that fill their cell. Arrows and
 * Enter move like a spreadsheet; a block copied from Excel is pasted into the
 * cells from the one chosen, right and down.
 */
export function Sheet<R>({
  rows,
  rowKey,
  rowNo,
  columns,
  onChange,
  foot,
  label,
}: {
  rows: R[];
  rowKey: (row: R) => string;
  rowNo: (row: R, i: number) => ReactNode;
  columns: SheetColumn<R>[];
  onChange: (i: number, key: string, value: string) => void;
  /** A totals row, one cell per column (after the row number). */
  foot?: ReactNode[];
  label: string;
}) {
  const box = useRef<HTMLTableElement>(null);
  const typed = columns.filter((c) => c.input);
  const at = (i: number, key: string) => box.current?.querySelector<HTMLInputElement>(`[data-cell="${i}:${key}"]`);

  const keyDown = (e: KeyboardEvent<HTMLInputElement>, i: number, key: string) => {
    const ci = typed.findIndex((c) => c.key === key);
    const go = (r: number, c: number) => {
      const el = at(r, typed[c]?.key ?? "");
      if (!el) return false;
      e.preventDefault();
      el.focus();
      el.select();
      return true;
    };
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) go(i + 1, ci);
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) go(i - 1, ci);
    else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) go(i, ci + 1);
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) go(i, ci - 1);
  };

  const paste = (e: ClipboardEvent<HTMLInputElement>, i: number, key: string) => {
    const text = e.clipboardData.getData("text/plain").replace(/\r?\n$/, "");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const start = typed.findIndex((c) => c.key === key);
    text.split(/\r?\n/).forEach((line, r) => {
      line.split("\t").forEach((v, c) => {
        const col = typed[start + c];
        if (col && i + r < rows.length) onChange(i + r, col.key, v.trim());
      });
    });
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
      <table ref={box} aria-label={label} className="w-full min-w-[36rem] border-collapse text-sm [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0">
        <colgroup>
          <col style={{ width: "3rem" }} />
          {columns.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="h-8 border border-t-0 border-line bg-surface-2 px-1 text-center text-xs font-medium text-muted">
              No.
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn("h-8 border border-t-0 border-line bg-surface-2 px-2 text-left text-xs font-medium whitespace-nowrap text-text-2", c.align === "right" && "text-right")}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)}>
              <th scope="row" className="h-9 border border-line bg-surface-2 px-1 text-center text-xs font-normal text-muted tabular">
                {rowNo(r, i)}
              </th>
              {columns.map((c) => (
                <td key={c.key} className={cn("h-9 border border-line text-sm", c.input ? "p-0" : "bg-surface-2/40 px-2 py-1 text-text-2", c.align === "right" && "text-right tabular")}>
                  {c.input ? (
                    <input
                      data-cell={`${i}:${c.key}`}
                      aria-label={c.aria?.(r) ?? c.label}
                      inputMode={c.input === "number" ? "decimal" : undefined}
                      maxLength={c.maxLength}
                      value={c.value?.(r) ?? ""}
                      onChange={(e) => onChange(i, c.key, e.target.value)}
                      onKeyDown={(e) => keyDown(e, i, c.key)}
                      onPaste={(e) => paste(e, i, c.key)}
                      onFocus={(e) => e.currentTarget.select()}
                      className={cn(
                        "block h-9 w-full min-w-0 border-0 bg-transparent px-2 text-sm outline-none focus:bg-surface focus:ring-2 focus:ring-primary focus:ring-inset",
                        c.align === "right" && "text-right tabular",
                      )}
                    />
                  ) : (
                    c.show?.(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="bg-surface-2 font-semibold">
              <th scope="row" className="h-9 border border-b-0 border-line px-1 text-center text-xs text-muted">
                Σ
              </th>
              {foot.map((f, n) => (
                <td key={n} className={cn("h-9 border border-b-0 border-line px-2 tabular", columns[n]?.align === "right" && "text-right")}>
                  {f}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
