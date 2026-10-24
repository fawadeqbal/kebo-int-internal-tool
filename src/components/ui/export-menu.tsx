"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { buttonClass } from "./index";
import { cn } from "@/lib/utils/cn";

/**
 * "Export" for a list or report. PDF is the formatted report; CSV (when
 * offered) is the raw data for Excel. Both use the filters on screen.
 */
export function ExportMenu({ pdfHref, csvHref, label = "Export" }: { pdfHref: string; csvHref?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!csvHref) {
    return (
      <a href={pdfHref} download className={buttonClass("secondary", "sm")}>
        <Download aria-hidden /> {label} PDF
      </a>
    );
  }
  const item = "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className={buttonClass("secondary", "sm")}>
        <Download aria-hidden /> {label}
        <ChevronDown className="opacity-60" aria-hidden />
      </button>
      {open && (
        <div role="menu" className={cn("absolute top-full right-0 z-40 mt-1.5 w-64 animate-in rounded-xl border border-line bg-surface p-1 shadow-pop")} onClick={() => setTimeout(() => setOpen(false), 0)}>
          <a role="menuitem" href={pdfHref} download className={item}>
            <FileText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-medium text-text">PDF report</span>
              <span className="block text-xs text-muted">Formatted, ready to print or send</span>
            </span>
          </a>
          <a role="menuitem" href={csvHref} download className={item}>
            <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            <span>
              <span className="block font-medium text-text">Spreadsheet (CSV)</span>
              <span className="block text-xs text-muted">All rows, for Excel or Google Sheets</span>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
