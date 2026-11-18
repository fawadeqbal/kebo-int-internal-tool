"use client";

import { ExcelMenu } from "@/components/sheets/excel-menu";
import { lineExport } from "@/components/sheets/line-sheets";
import type { LineColumn, LineRow } from "@/components/lines/line-table";

// The sheet itself is server-safe (a page can pass it columns that format their cells); here for the old imports.
export { LinesView } from "@/components/lines/lines-sheet";

/** The lines as an Excel file (the same export as the line table's Excel menu), for a card header. */
export function LinesExcel({ name, rows, columns, numbers, noun = "lines" }: { name: string; rows: LineRow[]; columns: LineColumn[]; numbers: string[]; noun?: string }) {
  if (!rows.length) return null;
  return <ExcelMenu noun={noun} exportSheet={() => lineExport({ name, columns, rows, numbers })} />;
}
