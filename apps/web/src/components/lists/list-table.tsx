import type { ComponentProps, ReactNode } from "react";
import { Card, DataRow, EmptyState, PhoneList, THead, Td, Th } from "@kebo/ui";
import { DataTable } from "@/components/common/data-table";
import { ListRow } from "./list-parts";
import { SelectCell, SelectHead } from "./selection";

/** One column of a list: its name, and what its cell shows for a row. */
export interface ListColumn<R> {
  key: string;
  header: ReactNode;
  cell: (row: R) => ReactNode;
  /** The cell's own classes (widths, no wrap, muted numbers). */
  className?: string;
}

/**
 * A list's rows (canvas "RFQ Desk — the pieces", board "List table and its cells"; design rule 15): a table on a
 * laptop — its columns passed in, a tick box per row while selecting — and on a phone each row in three lines
 * (ListRow). With no rows: one line and one button (EmptyState). The page says which columns and what each
 * cell shows; the piece lays them out the same way on every list.
 */
export function ListTable<R>({
  label,
  rows,
  rowKey,
  href,
  columns,
  phone,
  select,
  tableClassName,
  empty,
}: {
  /** The list's name for screen readers ("Inquiries"). */
  label: string;
  rows: R[];
  rowKey: (row: R) => string;
  /** Where a row goes. */
  href: (row: R) => string;
  columns: ListColumn<R>[];
  /** A row on a phone, in three lines (all but href). */
  phone: (row: R) => Omit<ComponentProps<typeof ListRow>, "href">;
  /** Tick boxes while selecting: each row's id and its name. */
  select?: (row: R) => { id: string; label: string };
  /** The table's own classes (its least width, its text size). */
  tableClassName?: string;
  /** With no rows. */
  empty: ComponentProps<typeof EmptyState>;
}) {
  return (
    <Card className="overflow-clip">
      {rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <>
          <PhoneList label={label}>
            {rows.map((r) => (
              <ListRow key={rowKey(r)} href={href(r)} {...phone(r)} />
            ))}
          </PhoneList>
          <DataTable label={label} className="max-sm:hidden" tableClassName={tableClassName}>
            <THead>
              <tr>
                {select && <SelectHead />}
                {columns.map((c) => (
                  <Th key={c.key}>{c.header}</Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => {
                const s = select?.(r);
                return (
                  <DataRow key={rowKey(r)} href={href(r)}>
                    {s && <SelectCell id={s.id} label={s.label} />}
                    {columns.map((c) => (
                      <Td key={c.key} className={c.className}>
                        {c.cell(r)}
                      </Td>
                    ))}
                  </DataRow>
                );
              })}
            </tbody>
          </DataTable>
        </>
      )}
    </Card>
  );
}
