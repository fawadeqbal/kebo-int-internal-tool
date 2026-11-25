"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { Button, buttonClass } from "@kebo/ui";
import type { DocLang } from "./zh";

/** The words on the language switch (the toolbar and the app's viewer). */
export const LANG_WORD: Record<DocLang, string> = { en: "English", zh: "English + 中文" };

/**
 * Above the sheet on screen, gone on paper: back to the order, the customer's or
 * the internal copy, English or English with Chinese, print, or download the PDF.
 */
export function PrintToolbar({
  title,
  backHref,
  pdfHref,
  excelHref,
  copies,
  languages,
}: {
  title: string;
  backHref: string;
  pdfHref: string;
  /** The same document as an Excel file (a quotation). */
  excelHref?: string;
  /** Priced documents: switch between the customer's copy (one total) and the internal one (every price, cost and payment). */
  copies?: { current: "customer" | "internal"; customer: string; internal: string };
  /** The paper in English, or with Chinese beside every label (?lang=zh); English unless chosen. */
  languages?: { current: DocLang; en: string; zh: string };
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  // Shown in the app's file viewer: it draws these buttons itself, so the paper tells it what they are.
  useEffect(() => {
    if (window.self === window.top) return;
    const abs = (h: string) => new URL(h, window.location.href).pathname + new URL(h, window.location.href).search;
    window.parent.postMessage(
      {
        type: "kebo-paper",
        title,
        pdfHref: abs(pdfHref),
        excelHref: excelHref && abs(excelHref),
        copies: copies && { current: copies.current, customer: abs(copies.customer), internal: abs(copies.internal) },
        languages: languages && { current: languages.current, en: abs(languages.en), zh: abs(languages.zh) },
      },
      window.location.origin,
    );
  }, [title, pdfHref, excelHref, copies, languages]);
  return (
    <div className="no-print sticky [html[data-embedded]_&]:hidden top-0 z-20 mb-6 border-b border-[#d0d7e2] bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-[#16151c]">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={backHref}
            onClick={(e) => {
              // Opened from a page of the app in this tab: Back goes to exactly that page (as the browser's Back does);
              // opened in a new tab or from outside, to the paper's own page.
              if (window.history.length > 1 && document.referrer && new URL(document.referrer).origin === window.location.origin) {
                e.preventDefault();
                router.back();
              }
            }}
            className={buttonClass("ghost", "sm", "text-[#4a4857] hover:bg-[#f2f2f5] hover:text-[#16151c]")}
          >
            <ArrowLeft aria-hidden /> Back
          </Link>
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {copies && (
            <div role="group" aria-label="Which copy" className="flex rounded-md border border-[#e4e4ea] bg-[#f6f6f8] p-0.5 text-sm">
              {(["customer", "internal"] as const).map((k) => (
                <Link
                  key={k}
                  href={copies[k]}
                  aria-current={copies.current === k ? "page" : undefined}
                  className={
                    copies.current === k
                      ? k === "internal"
                        ? "rounded px-2.5 py-1 font-medium bg-[#B91C1C] text-white"
                        : "rounded px-2.5 py-1 font-medium bg-white text-[#16151c] shadow-sm"
                      : "rounded px-2.5 py-1 text-[#4a4857] hover:text-[#16151c]"
                  }
                >
                  {k === "customer" ? "Customer copy" : "Internal copy"}
                </Link>
              ))}
            </div>
          )}
          {languages && (
            <div role="group" aria-label="Language" className="flex rounded-md border border-[#e4e4ea] bg-[#f6f6f8] p-0.5 text-sm">
              {(["en", "zh"] as const).map((k) => (
                <Link
                  key={k}
                  href={languages[k]}
                  aria-current={languages.current === k ? "page" : undefined}
                  className={
                    languages.current === k
                      ? "rounded px-2.5 py-1 font-medium bg-white text-[#16151c] shadow-sm"
                      : "rounded px-2.5 py-1 text-[#4a4857] hover:text-[#16151c]"
                  }
                >
                  {LANG_WORD[k]}
                </Link>
              ))}
            </div>
          )}
          {excelHref && (
            <a
              href={excelHref}
              download
              className={buttonClass("secondary", "sm", "border-[#e4e4ea] bg-white text-[#16151c] hover:bg-[#f2f2f5]")}
            >
              <FileSpreadsheet aria-hidden /> Excel
            </a>
          )}
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
