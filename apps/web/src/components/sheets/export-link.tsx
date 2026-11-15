"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { buildHref, buttonClass, cn } from "@kebo/ui";
import type { ExportKind } from "@/lib/exports";
import { useExcelAllowed } from "@/components/common/features";

/** "Export to Excel" for a list: every row with the filters on screen, as an .xlsx file. */
export function ExportLink({
  what,
  query = {},
  label = "Excel",
  className,
}: {
  what: ExportKind;
  query?: Record<string, string | undefined>;
  label?: string;
  className?: string;
}) {
  if (!useExcelAllowed()) return null;
  return (
    <a href={buildHref(`/sheets/export/${what}`, {}, query)} download className={cn(buttonClass("secondary", "sm"), "no-print", className)} title="Export to Excel">
      <FileSpreadsheet aria-hidden /> {label}
    </a>
  );
}

/**
 * A list's export, one look on every list (the board: "Export CSV" beside the page's main button): every row
 * with the filters on screen, as a CSV file Excel opens. Only for companies whose plan has Excel.
 */
export function ExportCsv({ what, query = {} }: { what: ExportKind; query?: Record<string, string | undefined> }) {
  if (!useExcelAllowed()) return null;
  return (
    <a href={buildHref(`/sheets/export/${what}`, {}, { ...query, format: "csv" })} download className={cn(buttonClass("secondary", "md"), "no-print")}>
      <Download aria-hidden /> Export CSV
    </a>
  );
}
