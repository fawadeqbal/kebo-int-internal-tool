import { PrintButton } from "@/components/ui/client";

export function PrintToolbar({ backHref, label }: { backHref: string; label: string }) {
  return (
    <div className="no-print mx-auto mb-6 flex max-w-[210mm] items-center justify-between gap-3 px-2">
      <a href={backHref} className="text-sm text-stone-600 hover:text-stone-900">
        ← Back to {label}
      </a>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-stone-500 sm:inline">Choose “Save as PDF” in the print dialog to get a PDF</span>
        <PrintButton />
      </div>
    </div>
  );
}
