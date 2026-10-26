"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { Button, buttonClass } from "@kebo/ui";

/** Above the sheet on screen, gone on paper: back to the order, print, or download the PDF. */
export function PrintToolbar({ title, backHref, pdfHref }: { title: string; backHref: string; pdfHref: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="no-print sticky top-0 z-20 mb-6 border-b border-[#d0d7e2] bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-[#16151c]">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={backHref} className={buttonClass("ghost", "sm", "text-[#4a4857] hover:bg-[#f2f2f5] hover:text-[#16151c]")}>
            <ArrowLeft aria-hidden /> Back
          </Link>
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={pdfHref}
            className={buttonClass("secondary", "sm", "border-[#e4e4ea] bg-white text-[#16151c] hover:bg-[#f2f2f5]")}
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => setBusy(false), 4000);
            }}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Download PDF
          </a>
          <Button size="sm" variant="primary" onClick={() => window.print()}>
            <Printer aria-hidden /> Print
          </Button>
        </div>
      </div>
    </div>
  );
}
