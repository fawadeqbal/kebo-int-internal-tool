import { FileDown } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/ui/client";

export function PrintToolbar({ backHref, label, pdfHref }: { backHref: string; label: string; pdfHref: string }) {
  return (
    <div className="no-print mx-auto mb-6 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-2">
      <a href={backHref} className="text-sm text-stone-600 hover:text-stone-900">
        ← Back to {label}
      </a>
      <div className="flex items-center gap-2">
        <PrintButton label="Print" variant="secondary" size="sm" />
        <a href={pdfHref} className={buttonClass("primary", "sm")} download>
          <FileDown aria-hidden /> Download PDF
        </a>
      </div>
    </div>
  );
}
