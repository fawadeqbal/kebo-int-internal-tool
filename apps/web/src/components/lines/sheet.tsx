"use client";

import { useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn, ScrollFade } from "@kebo/ui";

export interface SheetColumn<R> {
  key: string;
  label: string;
  /** e.g. "6rem" (on a phone too, unless `phoneWidth`); empty: takes the rest. */
  width?: string;
  /** A narrower width on a phone (a sheet that fits the phone). */
  phoneWidth?: string;
  align?: "right";
  /** Typed into while editing (a number or a short text); without it the column is shown only. */
  input?: "number" | "text";
  maxLength?: number;
  /** What the cell shows (always for a shown-only column; when not editing for a typed one, else its value). */
  show?: (row: R) => ReactNode;
  /** The value a typed column holds. */
  value?: (row: R) => string;
  /** Label for screen readers: "Packages for line 2". */
  aria?: (row: R) => string;
  /** Hidden below this screen size (its content then goes elsewhere in the row). */
  hideBelow?: "sm" | "md";
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell" } as const;

/**
 * The sheet for an order's goods and packing list: bordered cells and row
 * numbers, the same whether looked at or changed. While `editing`, the typed
 * columns become boxes that fill their cell; arrows and Enter move like a
 * spreadsheet, and a block copied from Excel is pasted into the cells from the
 * one chosen, right and down.
 */
export function Sheet<R>({
  rows,
  rowKey,
  rowNo,
  columns,
  onChange,
  editing = true,
  foot,
  label,
  fit,
  empty,
}: {
  rows: R[];
  rowKey: (row: R) => string;
  rowNo: (row: R, i: number) => ReactNode;
  columns: SheetColumn<R>[];
  onChange?: (row: R, key: string, value: string) => void;
  /** Typed columns are boxes (else everything is shown only). */
  editing?: boolean;
  /** A totals row, one cell per column (after the row number). */
  foot?: ReactNode[];
  label: string;
  /** Made to fit a phone (columns hidden or narrow there) instead of scrolling sideways. */
  fit?: boolean;
  /** Shown when there are no rows (e.g. a filter matches none). */
  empty?: ReactNode;
}) {
  const box = useRef<HTMLTableElement>(null);
  const typed = editing ? columns.filter((c) => c.input) : [];
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
        if (col && i + r < rows.length) onChange?.(rows[i + r]!, col.key, v.trim());
      });
    });
  };

  const cellPad = fit ? "px-1.5 sm:px-2" : "px-2";
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <ScrollFade className="overflow-x-auto" role="region" aria-label={label}>
        {/* Column widths for a phone and a wider screen, as CSS variables on each header cell. */}
        <table
          ref={box}
          data-fit={fit ? "" : undefined}
          className={cn(
            "w-full table-fixed border-collapse text-sm [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0",
            !fit && "min-w-[36rem]",
          )}
        >
          <thead>
            <tr>
              <th scope="col" className={cn("h-8 border border-t-0 border-line bg-surface-2 text-center text-xs font-medium text-muted", fit ? "w-8 px-0.5 sm:w-12 sm:px-1" : "w-12 px-1")}>
                No.
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? ({ "--w": c.width, "--pw": c.phoneWidth ?? c.width } as CSSProperties) : undefined}
                  className={cn(
                    "h-8 border border-t-0 border-line bg-surface-2 text-left text-xs font-medium whitespace-nowrap text-text-2",
                    cellPad,
                    c.width && "w-(--pw) sm:w-(--w)",
                    c.align === "right" && "text-right",
                    c.hideBelow && HIDE[c.hideBelow],
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-4 text-sm text-muted">
                  {empty ?? "Nothing here."}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={rowKey(r)}>
                <th
                  scope="row"
                  className={cn("h-9 border border-line bg-surface-2 text-center text-xs font-normal whitespace-nowrap text-muted tabular", fit ? "px-0.5 sm:px-1" : "px-1")}
                >
                  {rowNo(r, i)}
                </th>
                {columns.map((c) => {
                  const box = editing && c.input;
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "h-9 border border-line text-sm",
                        box ? "p-0" : cn(cellPad, "py-1.5"),
                        editing && !c.input && "bg-surface-2/40 text-text-2",
                        c.align === "right" && "text-right tabular",
                        c.hideBelow && HIDE[c.hideBelow],
                      )}
                    >
                      {box ? (
                        <input
                          data-cell={`${i}:${c.key}`}
                          aria-label={c.aria?.(r) ?? c.label}
                          inputMode={c.input === "number" ? "decimal" : undefined}
                          maxLength={c.maxLength}
                          value={c.value?.(r) ?? ""}
                          onChange={(e) => onChange?.(r, c.key, e.target.value)}
                          onKeyDown={(e) => keyDown(e, i, c.key)}
                          onPaste={(e) => paste(e, i, c.key)}
                          onFocus={(e) => e.currentTarget.select()}
                          className={cn(
                            // A box to type into: lightly tinted, so it is clear what can be changed.
                            "block h-9 w-full min-w-0 border-0 bg-primary-soft/25 px-2 text-sm outline-none focus:bg-surface focus:ring-2 focus:ring-primary focus:ring-inset",
                            c.align === "right" && "text-right tabular",
                          )}
                        />
                      ) : c.show ? (
                        c.show(r)
                      ) : (
                        (c.value?.(r) ?? "") || <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {foot && rows.length > 0 && (
            <tfoot>
              <tr className="bg-surface-2 font-semibold">
                <th scope="row" className="h-9 border border-b-0 border-line px-1 text-center text-xs text-muted">
                  Σ
                </th>
                {foot.map((f, n) => (
                  <td
                    key={n}
                    className={cn("h-9 border border-b-0 border-line tabular", cellPad, columns[n]?.align === "right" && "text-right", columns[n]?.hideBelow && HIDE[columns[n]!.hideBelow!])}
                  >
                    {f}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollFade>
    </div>
  );
}
