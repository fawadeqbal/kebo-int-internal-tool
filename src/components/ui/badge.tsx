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

export type { Tone };

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-text-2",
  primary: "bg-primary-soft text-primary",
  trust: "bg-trust-soft text-trust",
  money: "bg-money-soft text-money",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  outline: "border border-line text-text-2",
};

/** Colour is never the only signal: every badge carries its text label. */
export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const QueryStatusBadge = ({ status }: { status: QueryStatus }) => (
  <Badge tone={QUERY_STATUS_TONE[status]} dot>
    {QUERY_STATUS_LABEL[status]}
  </Badge>
);

export const QuotationStatusBadge = ({ status }: { status: QuotationStatus }) => (
  <Badge tone={QUOTATION_STATUS_TONE[status]} dot>
    {QUOTATION_STATUS_LABEL[status]}
  </Badge>
);

export const InvoiceStatusBadge = ({ status }: { status: InvoiceDisplayStatus }) => (
  <Badge tone={INVOICE_STATUS_TONE[status]} dot>
    {INVOICE_STATUS_LABEL[status]}
  </Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) => <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
