"use client";

import { FACT_LABEL, FACT_VALUE, FACTS_GRID } from "@/components/common/record-box";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@kebo/ui";

export interface RecordField {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

/**
 * One payment in a list: a one-line summary that opens into the full record
 * (read only), with Change and Remove at the bottom for people who may.
 */
export function PaymentRecord({
  summary,
  sub,
  removed = false,
  fields,
  actions,
}: {
  summary: ReactNode;
  sub: ReactNode;
  removed?: boolean;
  fields: RecordField[];
  actions?: ReactNode;
  /** "Payment of USD 14,692.15 on 12 Oct 2026" (the row is named by what it shows; aria-expanded says open or closed). */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("text-sm", removed && "text-muted")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2/60"
      >
        <span className="min-w-0">
          <span className="block">{summary}</span>
          <span className="block text-xs text-muted">{sub}</span>
        </span>
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-3">
          <dl className={FACTS_GRID}>
            {fields.map((f) => (
              <div key={f.label} className="contents">
                <dt className={FACT_LABEL}>{f.label}</dt>
                <dd className={FACT_VALUE}>{f.value}</dd>
              </div>
            ))}
          </dl>
          {actions && <div className="mt-3 flex flex-wrap items-start gap-1 border-t border-line pt-3">{actions}</div>}
        </div>
      )}
    </li>
  );
}

export interface RecordRow {
  key: string;
  /** One cell per column. */
  cells: ReactNode[];
  fields: RecordField[];
  actions?: ReactNode;
  removed?: boolean;
  /** For screen readers: "Payment of USD 14,692.15 on 12 Oct 2026". */
  label: string;
}
