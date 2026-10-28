import { FileSpreadsheet } from "lucide-react";
import { buildHref, buttonClass, cn } from "@kebo/ui";
import type { ExportKind } from "@/lib/exports";

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
  return (
    <a href={buildHref(`/sheets/export/${what}`, {}, query)} download className={cn(buttonClass("secondary", "sm"), "no-print", className)} title="Export to Excel">
      <FileSpreadsheet aria-hidden /> {label}
    </a>
  );
}
