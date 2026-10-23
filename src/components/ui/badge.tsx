import { cn } from "@/lib/utils/cn";
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  QUERY_STATUS_LABEL,
  QUERY_STATUS_TONE,
  QUOTATION_STATUS_LABEL,
  QUOTATION_STATUS_TONE,
  type InvoiceDisplayStatus,
  type Tone,
} from "@/lib/labels";
import type { Priority, QueryStatus, QuotationStatus } from "@/lib/db/schema";

const TONES: Record<Tone, string> = {
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  slate: "bg-stone-100 text-stone-700 ring-stone-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
  teal: "bg-brand-50 text-brand-800 ring-brand-200",
};

const DOTS: Record<Tone, string> = {
  amber: "bg-amber-500",
  blue: "bg-sky-500",
  slate: "bg-stone-400",
  green: "bg-emerald-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  teal: "bg-brand-500",
};

/** Colour is never the only signal: every badge carries its text label. */
export function Badge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} aria-hidden />
      {children}
    </span>
  );
}

export const QueryStatusBadge = ({ status }: { status: QueryStatus }) => (
  <Badge tone={QUERY_STATUS_TONE[status]}>{QUERY_STATUS_LABEL[status]}</Badge>
);

export const QuotationStatusBadge = ({ status }: { status: QuotationStatus }) => (
  <Badge tone={QUOTATION_STATUS_TONE[status]}>{QUOTATION_STATUS_LABEL[status]}</Badge>
);

export const InvoiceStatusBadge = ({ status }: { status: InvoiceDisplayStatus }) => (
  <Badge tone={INVOICE_STATUS_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>
);
