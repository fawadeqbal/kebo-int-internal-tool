"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Download, FileSpreadsheet, FolderDown, Printer } from "lucide-react";
import { buttonClass, cn } from "@kebo/ui";
import { useExcelAllowed } from "@/components/common/features";

/**
 * Excel, print and download, the same everywhere: at the top right of what
 * they belong to (the page header for a page or list, the card header for a
 * card, the right end of a row in a list of documents), in this order, with
 * these words. The page's main button (New…, Record…) comes after them.
 *
 * excel: the Excel menu (template, upload, export) where there is one, or
 * excelHref for a plain export.
 */
export function FileActions({
  excel,
  excelHref,
  viewHref,
  pdfHref,
  allHref,
  allCount,
  of,
  className,
}: {
  excel?: ReactNode;
  excelHref?: string;
  viewHref?: string;
  pdfHref?: string;
  /** Every file at once (a zip). */
  allHref?: string;
  allCount?: number;
  /** What the files are ("proforma invoice"), for screen readers when a list has several. */
  of?: string;
  className?: string;
}) {
  // Excel is a plan feature.
  if (!useExcelAllowed()) excelHref = undefined;
  if (!excel && !excelHref && !viewHref && !pdfHref && !allHref) return null;
  const b = buttonClass("secondary", "sm");
  return (
    <span className={cn("no-print flex flex-wrap items-center gap-2", className)}>
      {excel ??
        (excelHref && (
          <a href={excelHref} download className={b}>
            <FileSpreadsheet aria-hidden /> Excel{of && <span className="sr-only"> of the {of}</span>}
          </a>
        ))}
      {viewHref && (
        <Link href={viewHref} target="_blank" className={b}>
          {/* The words on the button start its name (what voice control users say); "of" only adds to it. */}
          <Printer aria-hidden /> View / Print{of && <span className="sr-only"> the {of}</span>}
        </Link>
      )}
      {pdfHref && (
        <a href={pdfHref} className={b}>
          <Download aria-hidden /> Download PDF{of && <span className="sr-only"> of the {of}</span>}
        </a>
      )}
      {allHref && (
        <a href={allHref} className={b}>
          <FolderDown aria-hidden /> Download all{allCount ? ` (${allCount})` : ""}
        </a>
      )}
    </span>
  );
}
