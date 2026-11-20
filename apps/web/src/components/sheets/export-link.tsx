"use client";

import { FileSpreadsheet } from "lucide-react";
import { buildHref, buttonClass, cn } from "@kebo/ui";
import type { ExportKind } from "@/lib/exports";
import { useExcelAllowed } from "@/components/common/features";
import { MoreMenu } from "@/components/common/more-menu";

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
 * A list's export, one look on every list (the list top of Inquiries, live audit 20 Nov): ⋯ beside the page's main
 * button, with Export to Excel and Export as CSV — every row with the filters on screen. Only for companies whose
 * plan has Excel.
 */
export function ExportCsv({ what, query = {}, label = "More for this list" }: { what: ExportKind; query?: Record<string, string | undefined>; label?: string }) {
  if (!useExcelAllowed()) return null;
  return (
    <MoreMenu
      label={label}
      className="no-print"
      items={[
        { label: "Export to Excel", href: buildHref(`/sheets/export/${what}`, {}, query), download: true },
        { label: "Export as CSV", href: buildHref(`/sheets/export/${what}`, {}, { ...query, format: "csv" }), download: true },
      ]}
    />
  );
}
