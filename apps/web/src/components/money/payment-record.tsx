"use client";

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
  label,
}: {
  summary: ReactNode;
  sub: ReactNode;
  removed?: boolean;
  fields: RecordField[];
  actions?: ReactNode;
  /** For screen readers: "Payment of USD 14,692.15 on 12 Oct 2026". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("text-sm", removed && "text-muted")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label}: ${open ? "hide" : "show"} the details`}
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
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
            {fields.map((f) => (
              <div key={f.label} className={cn("min-w-0", f.wide && "sm:col-span-3")}>
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
          {actions && <div className="mt-3 flex flex-wrap items-start gap-1 border-t border-line pt-3">{actions}</div>}
        </div>
      )}
    </li>
  );
}
