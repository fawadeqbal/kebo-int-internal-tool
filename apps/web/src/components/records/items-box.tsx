import type { ComponentProps, ReactNode } from "react";
import { RecordBox } from "@/components/common/record-box";
import { LinesView } from "@/components/lines/lines-sheet";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import { PhoneItems, type ItemsPhoneRow } from "./phone-items";
import { RULES, cn } from "@kebo/ui";

export type { ItemsPhoneRow } from "./phone-items";

/**
 * The one items box of a record (canvas board "What changes, piece by piece"): the record box (its count, the
 * clock, Excel and Edit), the items in the lined read-only sheet — the columns each record passes, from the one
 * set (Quantity and Unit apart; our cost and margin shaded), parts as 2.1 under their item — and the totals under
 * them. On a phone the item line of the edit window, read only (PhoneItems): five, then Show all; a tap, the item. The inquiry's Items, an offer's and a quotation's
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
      <ItemsBody label={label} rows={rows} columns={columns} numbers={numbers} after={after} totals={totals} phone={phone} empty={empty} />
    </RecordBox>
  );
}

/**
 * The inside of the items box, for a box that is drawn another way (an order's step box): the lined read-only
 * sheet on a laptop, the item lines on a phone, the totals under them.
 */
export function ItemsBody({
  label,
  rows,
  columns,
  numbers,
  after,
  totals,
  phone,
  empty,
}: {
  label: string;
  rows: LineRow[];
  columns: LineColumn[];
  numbers: string[];
  after?: ComponentProps<typeof LinesView>["after"];
  totals?: ReactNode;
  phone: ItemsPhoneRow[];
  empty: ReactNode;
}) {
  return rows.length ? (
    <>
      <div className="max-sm:hidden">
        <LinesView label={label} rows={rows} columns={columns} numbers={numbers} after={after} />
      </div>
      <PhoneItems label={label} rows={phone} />
      {totals && <div className="max-sm:border-t max-sm:border-line">{totals}</div>}
    </>
  ) : (
    <div className={cn(RULES.box.inset, "py-4 text-sm text-muted")}>{empty}</div>
  );
}
