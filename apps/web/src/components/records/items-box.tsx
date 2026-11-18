import type { ComponentProps, ReactNode } from "react";
import { cn } from "@kebo/ui";
import { RecordBox } from "@/components/common/record-box";
import { LinesView } from "@/components/lines/lines-sheet";
import type { LineColumn, LineRow } from "@/components/lines/line-table";

/** One item as a phone shows it: its number, its name, a grey line (quantity, price) and its amount on the right. */
export interface ItemsPhoneRow {
  key: string;
  no: string;
  /** A part of an item (2.1): indented under it. */
  part: boolean;
  title: ReactNode;
  sub: ReactNode;
  amount?: ReactNode;
  /** A line more under the grey one (our cost and margin). */
  more?: ReactNode;
  /** After the name (Edited 2×). */
  badge?: ReactNode;
}

/**
 * The one items box of a record (canvas board "What changes, piece by piece"): the record box (its count, the
 * clock, Excel and Edit), the items in the lined read-only sheet — the columns each record passes, from the one
 * set (Quantity and Unit apart; our cost and margin shaded), parts as 2.1 under their item — and the totals under
 * them. On a phone one row per item, the amount on the right. The inquiry's Items, an offer's and a quotation's
 * Prices are this box.
 */
export function ItemsBox({
  label,
  rows,
  columns,
  numbers,
  after,
  totals,
  phone,
  empty,
  ...box
}: Omit<ComponentProps<typeof RecordBox>, "children"> & {
  /** The sheet's name (it can scroll sideways, so Tab stops on it); unique on the page. */
  label: string;
  rows: LineRow[];
  columns: LineColumn[];
  numbers: string[];
  /** A narrow column at the end (a line's own history). */
  after?: ComponentProps<typeof LinesView>["after"];
  /** The totals block under the items (Totals). */
  totals?: ReactNode;
  phone: ItemsPhoneRow[];
  /** What it says with no items yet. */
  empty: ReactNode;
}) {
  return (
    <RecordBox {...box}>
      {rows.length ? (
        <>
          <div className="p-3 max-sm:hidden">
            <LinesView label={label} rows={rows} columns={columns} numbers={numbers} after={after} />
          </div>
          <ul aria-label={label} className="flex flex-col divide-y divide-line px-4 text-sm sm:hidden">
            {phone.map((r) => (
              <li key={r.key} className={cn("flex flex-col gap-1 py-2.5", r.part && "pl-4")}>
                <span className="flex gap-2">
                  <span className="w-6 shrink-0 text-xs text-muted tabular">{r.no}</span>
                  <span className={cn("min-w-0 flex-1 [overflow-wrap:anywhere]", !r.part && "font-medium")}>
                    {r.title}
                    {r.badge}
                  </span>
                </span>
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 pl-8 text-xs text-text-2 tabular">
                  <span>{r.sub}</span>
                  {r.amount && <span className="text-sm font-semibold text-text">{r.amount}</span>}
                </span>
                {r.more && <span className="pl-8 text-xs text-text-2 tabular">{r.more}</span>}
              </li>
            ))}
          </ul>
          {totals && <div className="max-sm:border-t max-sm:border-line">{totals}</div>}
        </>
      ) : (
        <div className="px-5 py-4 text-sm text-muted max-sm:px-4">{empty}</div>
      )}
    </RecordBox>
  );
}
